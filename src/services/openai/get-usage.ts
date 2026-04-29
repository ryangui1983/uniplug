import consola from "consola"

import { state } from "~/lib/state"

export interface OpenAIUsageResult {
  type: "api" | "session"
  totalCost?: number
  totalRequests?: number
  sessionRequests: number
  keyId?: string
  error?: string
}

// Cache: keyId → { result, fetchedAt }
const usageCache = new Map<
  string,
  { result: OpenAIUsageResult; fetchedAt: number }
>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function getOpenAIUsage(
  keyId: string,
): Promise<OpenAIUsageResult> {
  const sessionRequests = state.requestCountPerKey.get(keyId) ?? 0

  // Check cache
  const cached = usageCache.get(keyId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return { ...cached.result, sessionRequests }
  }

  // Find key in config
  const config = await import("~/lib/config").then((m) => m.getConfig())
  const keyConfig = config.openai.keys.find((k) => k.id === keyId)
  if (!keyConfig) {
    return { type: "session", sessionRequests, error: "Key not found" }
  }

  try {
    // Try OpenAI billing usage API
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startDate = startOfMonth.toISOString().split("T")[0]
    const endDate = now.toISOString().split("T")[0]

    const response = await fetch(
      `https://api.openai.com/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`,
      {
        headers: {
          authorization: `Bearer ${keyConfig.key}`,
        },
      },
    )

    if (!response.ok) {
      // Fall back to session counting
      const result: OpenAIUsageResult = {
        type: "session",
        sessionRequests,
        keyId,
        error: `Billing API returned ${response.status} (no billing access)`,
      }
      usageCache.set(keyId, { result, fetchedAt: Date.now() })
      return result
    }

    const data = (await response.json()) as { total_usage: number }
    const result: OpenAIUsageResult = {
      type: "api",
      totalCost: data.total_usage / 100, // in dollars
      sessionRequests,
      keyId,
    }
    usageCache.set(keyId, { result, fetchedAt: Date.now() })
    return result
  } catch (error) {
    consola.warn("Failed to fetch OpenAI usage:", error)
    const result: OpenAIUsageResult = {
      type: "session",
      sessionRequests,
      keyId,
      error: String(error),
    }
    usageCache.set(keyId, { result, fetchedAt: Date.now() })
    return result
  }
}

export function invalidateOpenAIUsageCache(keyId?: string): void {
  if (keyId) {
    usageCache.delete(keyId)
  } else {
    usageCache.clear()
  }
}
