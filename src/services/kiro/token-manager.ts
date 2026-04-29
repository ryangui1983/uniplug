import type { KiroAuthConfig } from "~/lib/config"

import { getConfig } from "~/lib/config"
import { HTTPError } from "~/lib/error"

import type { KiroTokenInfo, KiroUsageInfo } from "./types"

import { getKiroAuthConfigs } from "./auth-config"
import {
  KIRO_IDC_REFRESH_URL,
  KIRO_SDK_VERSION,
  KIRO_SOCIAL_REFRESH_URL,
  KIRO_USAGE_LIMITS_URL,
  KIRO_VERSION,
} from "./constants"

const STATIC_AMZ_USER_AGENT = `aws-sdk-js/${KIRO_SDK_VERSION} KiroIDE-${KIRO_VERSION}`
const STATIC_AWS_USER_AGENT = `aws-sdk-js/${KIRO_SDK_VERSION} ua/2.1 os/windows lang/js md/nodejs#20.0.0 api/codewhispererstreaming#${KIRO_SDK_VERSION} m/E KiroIDE-${KIRO_VERSION}`

interface RefreshResponse {
  accessToken: string
  expiresIn?: number
  refreshToken?: string
  profileArn?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseRefreshResponse(value: unknown): RefreshResponse {
  if (!isRecord(value)) {
    throw new Error("Kiro refresh response is not an object")
  }

  const accessToken = readString(value.accessToken)
  if (!accessToken) {
    throw new Error("Kiro refresh response missing accessToken")
  }

  return {
    accessToken,
    expiresIn: readNumber(value.expiresIn),
    refreshToken: readString(value.refreshToken),
    profileArn: readString(value.profileArn),
  }
}

async function refreshSocialToken(
  auth: KiroAuthConfig,
): Promise<RefreshResponse> {
  const response = await fetch(KIRO_SOCIAL_REFRESH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: auth.refreshToken }),
  })

  if (!response.ok) {
    throw new HTTPError("Kiro Social token refresh failed", response)
  }

  return parseRefreshResponse(await response.json())
}

async function refreshIdcToken(auth: KiroAuthConfig): Promise<RefreshResponse> {
  const response = await fetch(KIRO_IDC_REFRESH_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "*/*",
      "user-agent": "node",
      "x-amz-user-agent":
        "aws-sdk-js/3.738.0 ua/2.1 os/other lang/js md/browser#unknown_unknown api/sso-oidc#3.738.0 m/E KiroIDE",
      "accept-encoding": "br, gzip, deflate",
    },
    body: JSON.stringify({
      clientId: auth.clientId,
      clientSecret: auth.clientSecret,
      refreshToken: auth.refreshToken,
      grantType: "refresh_token",
    }),
  })

  if (!response.ok) {
    throw new HTTPError("Kiro IdC token refresh failed", response)
  }

  return parseRefreshResponse(await response.json())
}

function extractAvailableCredits(value: unknown): number | null {
  if (!isRecord(value)) return null
  const breakdown = value.breakdown
  if (!Array.isArray(breakdown)) return null

  let total = 0
  let matched = false
  for (const item of breakdown) {
    if (!isRecord(item) || item.resourceType !== "CREDIT") continue
    const available = readNumber(item.available) ?? readNumber(item.remaining)
    if (available !== undefined) {
      total += available
      matched = true
    }
  }

  return matched ? total : null
}

async function checkUsageLimits(token: string): Promise<KiroUsageInfo> {
  const response = await fetch(KIRO_USAGE_LIMITS_URL, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": STATIC_AWS_USER_AGENT,
      "x-amz-user-agent": STATIC_AMZ_USER_AGENT,
    },
  })

  if (!response.ok) {
    return { available: null }
  }

  const raw = await response.json()
  return { available: extractAvailableCredits(raw), raw }
}

export class KiroTokenManager {
  private cache = new Map<string, KiroTokenInfo>()

  clear(): void {
    this.cache.clear()
  }

  async getToken(): Promise<KiroTokenInfo> {
    const authConfigs = getKiroAuthConfigs()
    if (authConfigs.length === 0) {
      throw new Error("Kiro auth is not configured")
    }

    const errors: Array<unknown> = []
    for (const auth of authConfigs) {
      try {
        const token = await this.getTokenForAuth(auth)
        if (getConfig().kiro.checkUsageLimits === false) {
          return token
        }

        const usage = await checkUsageLimits(token.accessToken)
        if (usage.available === null || usage.available > 0) {
          return token
        }
      } catch (error) {
        errors.push(error)
      }
    }

    const lastError = errors.at(-1)
    throw new Error(
      `No usable Kiro auth token found: ${lastError ? errorMessage(lastError) : "unknown"}`,
    )
  }

  private async getTokenForAuth(auth: KiroAuthConfig): Promise<KiroTokenInfo> {
    const cached = this.cache.get(auth.id)
    if (cached && cached.expiresAt > Date.now()) {
      return cached
    }

    const refreshed =
      auth.auth === "Social" ?
        await refreshSocialToken(auth)
      : await refreshIdcToken(auth)
    const expiresIn = refreshed.expiresIn ?? 3600
    const token: KiroTokenInfo = {
      accessToken: refreshed.accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - 30_000,
      authConfigId: auth.id,
      label: auth.label,
      ...(refreshed.refreshToken ?
        { refreshToken: refreshed.refreshToken }
      : {}),
    }

    const profileArn = auth.profileArn ?? refreshed.profileArn
    if (profileArn) token.profileArn = profileArn
    if (auth.machineId) token.machineId = auth.machineId
    if (auth.region) token.region = auth.region

    this.cache.set(auth.id, token)
    return token
  }
}

export const kiroTokenManager = new KiroTokenManager()

export { KIRO_TOKEN_CACHE_TTL_MS } from "./constants"
