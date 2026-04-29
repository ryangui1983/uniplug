import consola from "consola"

import { AllProvidersExhaustedError } from "~/lib/error"
import { sleep } from "~/lib/utils"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"

import { getConfig } from "./config"
import { state, type ProviderSwitchLogEntry } from "./state"
import { cacheCopilotModels, cacheOpenAIModels } from "./utils"

// Cached copilot usage to avoid calling API on every request
let cachedCopilotPremiumInteractions: {
  used: number
  entitlement: number
  fetchedAt: number
} | null = null
const COPILOT_USAGE_TTL = 5 * 60 * 1000 // 5 minutes

async function getCopilotPremiumInteractionsUsed(): Promise<number> {
  if (
    cachedCopilotPremiumInteractions
    && Date.now() - cachedCopilotPremiumInteractions.fetchedAt
      < COPILOT_USAGE_TTL
  ) {
    return cachedCopilotPremiumInteractions.used
  }

  try {
    const usage = await getCopilotUsage()
    const detail = usage.quota_snapshots.premium_interactions
    // used = entitlement - remaining
    const used = detail.unlimited ? 0 : detail.entitlement - detail.remaining
    const entitlement = detail.unlimited ? Infinity : detail.entitlement
    // eslint-disable-next-line require-atomic-updates
    cachedCopilotPremiumInteractions = {
      used,
      entitlement,
      fetchedAt: Date.now(),
    }
    return used
  } catch {
    // If we can't fetch usage, assume it's still available
    return 0
  }
}

export function invalidateCopilotUsageCache(): void {
  cachedCopilotPremiumInteractions = null
}

function isCopilotAvailable(): boolean {
  const config = getConfig()
  const copilotCfg = config.copilot

  if (copilotCfg.force) return true

  // Check cached usage
  if (!cachedCopilotPremiumInteractions) return true

  // Use manual threshold if set; otherwise use entitlement from API
  const threshold = cachedCopilotPremiumInteractions.entitlement
  if (!threshold || !Number.isFinite(threshold)) return true

  return cachedCopilotPremiumInteractions.used < threshold
}

function isOpenAIKeyAvailable(keyId: string | undefined): boolean {
  if (!keyId) return false
  const status = state.keyStatus.get(keyId)
  if (!status?.exhausted) return true

  // Auto-reset if exhaustedAt is before today's UTC midnight
  if (status.exhaustedAt) {
    const todayUTCMidnight = new Date()
    todayUTCMidnight.setUTCHours(0, 0, 0, 0)
    if (status.exhaustedAt < todayUTCMidnight) {
      state.keyStatus.set(keyId, { exhausted: false })
      return true
    }
  }

  return false
}

function getNextAvailableOpenAIKeyId(): string | undefined {
  const config = getConfig()
  for (const key of config.openai.keys) {
    if (isOpenAIKeyAvailable(key.id)) {
      return key.id
    }
  }
  return undefined
}

function logSwitch(entry: Omit<ProviderSwitchLogEntry, "timestamp">): void {
  const logEntry: ProviderSwitchLogEntry = {
    ...entry,
    timestamp: new Date(),
  }
  state.providerSwitchLog.unshift(logEntry)
  // Keep only last 20 entries
  if (state.providerSwitchLog.length > 20) {
    state.providerSwitchLog = state.providerSwitchLog.slice(0, 20)
  }
  consola.info(`[Provider Switch] ${entry.from} → ${entry.to}: ${entry.reason}`)
}

async function performSwitch(): Promise<void> {
  const config = getConfig()
  const currentProvider = state.provider
  const oldModel =
    currentProvider === "openai" ?
      config.openai.mainModel
    : config.copilot.mainModel

  if (currentProvider === "openai") {
    const currentKeyId = config.openai.activeKeyId
    // Mark current key as exhausted
    if (currentKeyId) {
      state.keyStatus.set(currentKeyId, {
        exhausted: true,
        exhaustedAt: new Date(),
      })
    }

    // Try next available OpenAI key
    const nextKeyId = getNextAvailableOpenAIKeyId()
    if (nextKeyId) {
      const nextKey = config.openai.keys.find((k) => k.id === nextKeyId)
      if (!nextKey) throw new AllProvidersExhaustedError()
      const { writeConfig } = await import("./config")
      writeConfig({
        ...config,
        openai: { ...config.openai, activeKeyId: nextKeyId },
      })
      // eslint-disable-next-line require-atomic-updates
      state.openaiApiKey = nextKey.key

      logSwitch({
        from: `openai:${currentKeyId}`,
        to: `openai:${nextKeyId}`,
        reason: "OpenAI key quota exhausted, switched to next key",
        oldModel,
        newModel: config.openai.mainModel,
      })
      return
    }

    // All OpenAI keys exhausted, fall back to Copilot
    if (isCopilotAvailable() && state.copilotToken) {
      state.provider = "copilot"
      try {
        await cacheCopilotModels()
      } catch {
        // Ignore model cache failure
      }
      logSwitch({
        from: "openai",
        to: "copilot",
        reason: "All OpenAI keys exhausted, switched to GitHub Copilot",
        oldModel,
        newModel: config.copilot.mainModel,
      })
      return
    }

    throw new AllProvidersExhaustedError()
  }

  // currentProvider === "copilot"
  // Copilot quota exceeded + force=false
  const availableKeyId = getNextAvailableOpenAIKeyId()
  if (availableKeyId) {
    const nextKey = config.openai.keys.find((k) => k.id === availableKeyId)
    if (!nextKey) throw new AllProvidersExhaustedError()
    const { writeConfig } = await import("./config")
    writeConfig({
      ...config,
      openai: { ...config.openai, activeKeyId: availableKeyId },
    })
    // eslint-disable-next-line require-atomic-updates
    state.openaiApiKey = nextKey.key
    // eslint-disable-next-line require-atomic-updates
    state.provider = "openai"
    try {
      await cacheOpenAIModels()
    } catch {
      // Ignore model cache failure
    }
    logSwitch({
      from: "copilot",
      to: `openai:${availableKeyId}`,
      reason: "Copilot quota threshold reached, switched to OpenAI",
      oldModel,
      newModel: config.openai.mainModel,
    })
    return
  }

  throw new AllProvidersExhaustedError()
}

export async function ensureProviderAvailable(): Promise<void> {
  const config = getConfig()

  if (!config.autoSwitch) return

  // Wait if another request is already switching (up to 3 seconds)
  if (state.isSwitching) {
    const deadline = Date.now() + 3000
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    while (state.isSwitching && Date.now() < deadline) {
      await sleep(100)
    }
    return
  }

  // Check if Copilot usage needs refreshing before evaluating availability
  if (state.provider === "copilot") {
    await getCopilotPremiumInteractionsUsed()
  }

  // Check current provider availability
  if (state.provider === "openai") {
    const activeKeyId = config.openai.activeKeyId
    if (isOpenAIKeyAvailable(activeKeyId)) return
  } else if (
    state.provider === "ollama"
    || state.provider === "claude"
    || state.provider === "deepseek"
    || state.provider === "mimo"
    || state.provider === "kiro"
  ) {
    // Ollama, Claude Direct, DeepSeek, MiMo, and Kiro don't participate in auto-switching
    return
  } else if (isCopilotAvailable()) return

  // Need to switch

  state.isSwitching = true
  try {
    await performSwitch()
  } finally {
    // eslint-disable-next-line require-atomic-updates
    state.isSwitching = false
  }
}
