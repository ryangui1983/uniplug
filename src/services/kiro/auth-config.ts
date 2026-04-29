import { randomUUID } from "node:crypto"
import fs from "node:fs"

import type { KiroAuthConfig } from "~/lib/config"

import { getConfig } from "~/lib/config"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function normalizeAuthConfig(
  value: unknown,
  index: number,
): KiroAuthConfig | null {
  if (!isRecord(value)) return null

  const auth = readString(value.auth)
  if (auth !== "Social" && auth !== "IdC") return null

  const refreshToken = readString(value.refreshToken)
  if (!refreshToken) return null

  const clientId = readString(value.clientId)
  const clientSecret = readString(value.clientSecret)
  if (auth === "IdC" && (!clientId || !clientSecret)) return null

  return {
    id: readString(value.id) ?? randomUUID(),
    label: readString(value.label) ?? `Kiro ${index + 1}`,
    auth,
    refreshToken,
    ...(clientId ? { clientId } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(readString(value.machineId) ?
      { machineId: readString(value.machineId) }
    : {}),
    ...(readString(value.profileArn) ?
      { profileArn: readString(value.profileArn) }
    : {}),
    ...(readString(value.region) ? { region: readString(value.region) } : {}),
    ...(value.disabled === true ? { disabled: true } : {}),
  }
}

function parseAuthJson(raw: string): Array<KiroAuthConfig> {
  const parsed = JSON.parse(raw) as unknown
  const values = Array.isArray(parsed) ? parsed : [parsed]
  return values
    .map((value, index) => normalizeAuthConfig(value, index))
    .filter((value): value is KiroAuthConfig => value !== null)
}

export function parseKiroAuthTokenSource(
  source: string,
): Array<KiroAuthConfig> {
  const trimmed = source.trim()
  if (!trimmed) return []

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseAuthJson(trimmed)
  }

  if (!fs.existsSync(trimmed)) {
    return []
  }

  const fileContent = fs.readFileSync(trimmed, "utf8")
  return parseAuthJson(fileContent)
}

export function getKiroAuthConfigs(): Array<KiroAuthConfig> {
  const configAuth = getConfig().kiro.auth.filter((auth) => !auth.disabled)
  const envAuth =
    process.env.KIRO_AUTH_TOKEN ?
      parseKiroAuthTokenSource(process.env.KIRO_AUTH_TOKEN)
    : []

  return [...configAuth, ...envAuth].filter((auth) => !auth.disabled)
}

export function hasKiroAuthConfig(): boolean {
  return getKiroAuthConfigs().length > 0
}

export function getKiroAuthStatus(): { configured: boolean; count: number } {
  const authConfigs = getKiroAuthConfigs()
  return { configured: authConfigs.length > 0, count: authConfigs.length }
}
