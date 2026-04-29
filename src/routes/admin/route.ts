/* eslint-disable max-lines */
import { Hono } from "hono"
import { randomUUID } from "node:crypto"

import {
  addAccount,
  getAccounts,
  getActiveAccount,
  removeAccount,
  setActiveAccount,
  type Account,
} from "~/lib/accounts"
import { getClaudeCredentialsStatus } from "~/lib/claude-credentials"
import {
  getConfig,
  saveConfig,
  writeConfig,
  getMainModel,
  getSmallModelForProvider,
  type OpenAIKeyConfig,
  type MimoKeyConfig,
  type DeepSeekKeyConfig,
  type KiroAuthConfig,
} from "~/lib/config"
import { copilotTokenManager } from "~/lib/copilot-token-manager"
import { PATHS } from "~/lib/paths"
import { invalidateCopilotUsageCache } from "~/lib/provider-switch"
import { applyEnvVarsToSystem, clearEnvVarsFromSystem } from "~/lib/shell"
import { state } from "~/lib/state"
import {
  cacheCopilotModels,
  cacheOpenAIModels,
  cacheDeepSeekModels,
  cacheMimoModels,
  cacheClaudeModels,
  cacheOllamaModels,
  cacheKiroModels,
} from "~/lib/utils"
import { getCopilotUsage } from "~/services/github/get-copilot-usage"
import { getDeviceCode } from "~/services/github/get-device-code"
import { getGitHubUser } from "~/services/github/get-user"
import { pollAccessTokenOnce } from "~/services/github/poll-access-token"
import {
  getKiroAuthStatus,
  hasKiroAuthConfig,
} from "~/services/kiro/auth-config"
import { kiroTokenManager } from "~/services/kiro/token-manager"
import {
  getOpenAIUsage,
  invalidateOpenAIUsageCache,
} from "~/services/openai/get-usage"

import { localOnlyMiddleware } from "./middleware"
import { getWebUI } from "./ui"

export const adminRoutes = new Hono()

// Apply localhost-only middleware to all admin routes
adminRoutes.use("*", localOnlyMiddleware)

// ── Web UI ────────────────────────────────────────────────────────────────────

adminRoutes.get("/", (c) => c.html(getWebUI()))

// ── Status ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line complexity
adminRoutes.get("/api/status", async (c) => {
  const config = getConfig()

  const keyStatuses: Record<
    string,
    { exhausted: boolean; exhaustedAt?: string; sessionRequests: number }
  > = {}
  for (const key of config.openai.keys) {
    const ks = state.keyStatus.get(key.id)
    keyStatuses[key.id] = {
      exhausted: ks?.exhausted ?? false,
      exhaustedAt: ks?.exhaustedAt?.toISOString(),
      sessionRequests: state.requestCountPerKey.get(key.id) ?? 0,
    }
  }

  const activeKey = config.openai.keys.find(
    (k) => k.id === config.openai.activeKeyId,
  )

  // Try to get copilot usage if connected
  let copilotUsage = null
  if (state.copilotToken && state.githubToken) {
    try {
      copilotUsage = await getCopilotUsage()
    } catch {
      // ignore
    }
  }

  return c.json({
    provider: state.provider,
    port: state.port,
    activeKeyId: config.openai.activeKeyId,
    activeKeyLabel: activeKey?.label,
    keyStatuses,
    switchLog: state.providerSwitchLog,
    copilotConnected: !state.githubTokenMissing && Boolean(state.copilotToken),
    githubUser: null,
    copilotUsage,
    allModels: state.models?.data ?? [],
    copilotModels:
      state.provider === "copilot" ? (state.models?.data ?? []) : [],
    openaiModels: state.provider === "openai" ? (state.models?.data ?? []) : [],
    deepseekModels:
      state.provider === "deepseek" ? (state.models?.data ?? []) : [],
    mimoModels: state.provider === "mimo" ? (state.models?.data ?? []) : [],
    claudeModels: state.provider === "claude" ? (state.models?.data ?? []) : [],
    ollamaModels: state.provider === "ollama" ? (state.models?.data ?? []) : [],
    kiroModels: state.provider === "kiro" ? (state.models?.data ?? []) : [],
    claudeCredentials: getClaudeCredentialsStatus(),
    kiroAuth: getKiroAuthStatus(),
    activeMimoKeyId: config.mimo.activeKeyId,
    activeDeepSeekKeyId: config.deepseek.activeKeyId,
    logDir: PATHS.LOG_DIR,
  })
})

// ── Config ────────────────────────────────────────────────────────────────────

adminRoutes.get("/api/config", (c) => {
  const config = getConfig()
  const maskedConfig = {
    ...config,
    openai: {
      ...config.openai,
      keys: config.openai.keys.map((k) => ({
        ...k,
        key: maskKey(k.key),
      })),
    },
    deepseek: {
      ...config.deepseek,
      keys: config.deepseek.keys.map((k) => ({
        ...k,
        key: maskKey(k.key),
      })),
    },
    mimo: {
      ...config.mimo,
      keys: config.mimo.keys.map((k) => ({
        ...k,
        key: maskKey(k.key),
      })),
    },
    kiro: {
      ...config.kiro,
      auth: config.kiro.auth.map((auth) => ({
        ...auth,
        refreshToken: maskSecret(auth.refreshToken),
        ...(auth.clientSecret ?
          { clientSecret: maskSecret(auth.clientSecret) }
        : {}),
      })),
    },
  }
  return c.json(maskedConfig)
})

adminRoutes.put("/api/config", async (c) => {
  const body =
    await c.req.json<
      typeof import("~/lib/config").getConfig extends () => infer R ? R : never
    >()
  const current = getConfig()

  const mergedKeys: Array<OpenAIKeyConfig> = body.openai.keys.map(
    (incoming) => {
      if (isMaskedKey(incoming.key)) {
        const existing = current.openai.keys.find((k) => k.id === incoming.id)
        return existing ?? incoming
      }
      return incoming
    },
  )

  const merged = {
    ...current,
    ...body,
    openai: {
      ...current.openai,
      ...body.openai,
      keys: mergedKeys,
    },
    copilot: {
      ...current.copilot,
      ...body.copilot,
    },
    deepseek: {
      ...current.deepseek,
      ...body.deepseek,
      keys: current.deepseek.keys, // never overwrite keys via PUT config
    },
    mimo: {
      ...current.mimo,
      ...body.mimo,
      keys: current.mimo.keys, // never overwrite keys via PUT config
    },
    claude: {
      ...current.claude,
      ...body.claude,
    },
    ollama: {
      ...current.ollama,
      ...body.ollama,
    },
    kiro: {
      ...current.kiro,
      ...body.kiro,
      auth: current.kiro.auth,
    },
    auth: {
      ...current.auth,
      ...body.auth,
    },
  }

  writeConfig(merged)
  return c.json(merged)
})

// ── OpenAI Keys ───────────────────────────────────────────────────────────────

adminRoutes.post("/api/config/openai/keys", async (c) => {
  const { key, label } = await c.req.json<{ key: string; label?: string }>()
  const config = getConfig()

  const newKey: OpenAIKeyConfig = {
    id: randomUUID(),
    key,
    label: label ?? `Key ${config.openai.keys.length + 1}`,
  }

  const updatedKeys = [...config.openai.keys, newKey]
  const isFirst = config.openai.keys.length === 0

  const updated = {
    ...config,
    openai: {
      ...config.openai,
      keys: updatedKeys,
      ...(isFirst ? { activeKeyId: newKey.id } : {}),
    },
  }
  writeConfig(updated)

  if (isFirst) {
    state.openaiApiKey = key
    state.keyStatus.set(newKey.id, { exhausted: false })
    state.requestCountPerKey.set(newKey.id, 0)
  }

  const usagePromise = getOpenAIUsage(newKey.id).catch(() => null)

  return c.json({
    key: { ...newKey, key: maskKey(key) },
    isFirst,
    verification: await usagePromise,
  })
})

adminRoutes.delete("/api/config/openai/keys/:id", (c) => {
  const id = c.req.param("id")
  const config = getConfig()

  const updatedKeys = config.openai.keys.filter((k) => k.id !== id)
  const wasActive = config.openai.activeKeyId === id
  const newActiveId = wasActive ? updatedKeys[0]?.id : config.openai.activeKeyId

  writeConfig({
    ...config,
    openai: {
      ...config.openai,
      keys: updatedKeys,
      activeKeyId: newActiveId,
    },
  })

  state.keyStatus.delete(id)
  state.requestCountPerKey.delete(id)
  invalidateOpenAIUsageCache(id)

  if (wasActive && newActiveId) {
    const newKey = updatedKeys.find((k) => k.id === newActiveId)
    if (newKey) state.openaiApiKey = newKey.key
  } else if (wasActive) {
    state.openaiApiKey = undefined
  }

  return c.json({ success: true })
})

adminRoutes.put("/api/config/openai/keys/:id/activate", async (c) => {
  const id = c.req.param("id")
  const config = getConfig()

  const key = config.openai.keys.find((k) => k.id === id)
  if (!key) return c.json({ error: "Key not found" }, 404)

  writeConfig({
    ...config,
    openai: { ...config.openai, activeKeyId: id },
  })

  state.openaiApiKey = key.key

  try {
    await cacheOpenAIModels()
  } catch {
    // ignore
  }

  return c.json({ success: true })
})

adminRoutes.post("/api/config/openai/keys/:id/reset-exhausted", (c) => {
  const id = c.req.param("id")
  const status = state.keyStatus.get(id)
  if (!status) return c.json({ error: "Key not found" }, 404)

  state.keyStatus.set(id, { exhausted: false })
  return c.json({ success: true })
})

// ── MiMo Keys ─────────────────────────────────────────────────────────────────

adminRoutes.post("/api/config/mimo/keys", async (c) => {
  const { key, label } = await c.req.json<{ key: string; label?: string }>()
  const config = getConfig()

  const newKey: MimoKeyConfig = {
    id: randomUUID(),
    key,
    label: label ?? `Key ${config.mimo.keys.length + 1}`,
  }

  const updatedKeys = [...config.mimo.keys, newKey]
  const isFirst = config.mimo.keys.length === 0

  const updated = {
    ...config,
    mimo: {
      ...config.mimo,
      keys: updatedKeys,
      ...(isFirst ? { activeKeyId: newKey.id } : {}),
    },
  }
  writeConfig(updated)

  if (isFirst) {
    state.mimoApiKey = key
  }

  return c.json({ key: { ...newKey, key: maskKey(key) }, isFirst })
})

adminRoutes.delete("/api/config/mimo/keys/:id", (c) => {
  const id = c.req.param("id")
  const config = getConfig()

  const updatedKeys = config.mimo.keys.filter((k) => k.id !== id)
  const wasActive = config.mimo.activeKeyId === id
  const newActiveId = wasActive ? updatedKeys[0]?.id : config.mimo.activeKeyId

  writeConfig({
    ...config,
    mimo: {
      ...config.mimo,
      keys: updatedKeys,
      activeKeyId: newActiveId,
    },
  })

  if (wasActive && newActiveId) {
    const newKey = updatedKeys.find((k) => k.id === newActiveId)
    if (newKey) state.mimoApiKey = newKey.key
  } else if (wasActive) {
    state.mimoApiKey = undefined
  }

  return c.json({ success: true })
})

adminRoutes.put("/api/config/mimo/keys/:id/activate", async (c) => {
  const id = c.req.param("id")
  const config = getConfig()

  const key = config.mimo.keys.find((k) => k.id === id)
  if (!key) return c.json({ error: "Key not found" }, 404)

  writeConfig({
    ...config,
    mimo: { ...config.mimo, activeKeyId: id },
  })

  state.mimoApiKey = key.key

  try {
    await cacheMimoModels()
  } catch {
    // ignore
  }

  return c.json({ success: true })
})

// ── DeepSeek Keys ─────────────────────────────────────────────────────────────

adminRoutes.post("/api/config/deepseek/keys", async (c) => {
  const { key, label } = await c.req.json<{ key: string; label?: string }>()
  const config = getConfig()

  const newKey: DeepSeekKeyConfig = {
    id: randomUUID(),
    key,
    label: label ?? `Key ${config.deepseek.keys.length + 1}`,
  }

  const updatedKeys = [...config.deepseek.keys, newKey]
  const isFirst = config.deepseek.keys.length === 0

  const updated = {
    ...config,
    deepseek: {
      ...config.deepseek,
      keys: updatedKeys,
      ...(isFirst ? { activeKeyId: newKey.id } : {}),
    },
  }
  writeConfig(updated)

  if (isFirst) {
    state.deepseekApiKey = key
  }

  return c.json({ key: { ...newKey, key: maskKey(key) }, isFirst })
})

adminRoutes.delete("/api/config/deepseek/keys/:id", (c) => {
  const id = c.req.param("id")
  const config = getConfig()

  const updatedKeys = config.deepseek.keys.filter((k) => k.id !== id)
  const wasActive = config.deepseek.activeKeyId === id
  const newActiveId =
    wasActive ? updatedKeys[0]?.id : config.deepseek.activeKeyId

  writeConfig({
    ...config,
    deepseek: {
      ...config.deepseek,
      keys: updatedKeys,
      activeKeyId: newActiveId,
    },
  })

  if (wasActive && newActiveId) {
    const newKey = updatedKeys.find((k) => k.id === newActiveId)
    if (newKey) state.deepseekApiKey = newKey.key
  } else if (wasActive) {
    state.deepseekApiKey = undefined
  }

  return c.json({ success: true })
})

adminRoutes.put("/api/config/deepseek/keys/:id/activate", (c) => {
  const id = c.req.param("id")
  const config = getConfig()

  const key = config.deepseek.keys.find((k) => k.id === id)
  if (!key) return c.json({ error: "Key not found" }, 404)

  writeConfig({
    ...config,
    deepseek: { ...config.deepseek, activeKeyId: id },
  })

  state.deepseekApiKey = key.key

  try {
    cacheDeepSeekModels()
  } catch {
    // ignore
  }

  return c.json({ success: true })
})

// ── Kiro Auth ─────────────────────────────────────────────────────────────────

adminRoutes.post("/api/config/kiro/auth", async (c) => {
  const body = await c.req.json<{
    label?: string
    auth?: "Social" | "IdC"
    refreshToken?: string
    clientId?: string
    clientSecret?: string
  }>()
  const config = getConfig()
  const authType = body.auth ?? "Social"
  if (!body.refreshToken) {
    return c.json({ error: "refreshToken is required" }, 400)
  }
  if (authType === "IdC" && (!body.clientId || !body.clientSecret)) {
    return c.json(
      { error: "clientId and clientSecret are required for IdC" },
      400,
    )
  }

  const newAuth: KiroAuthConfig = {
    id: randomUUID(),
    label: body.label ?? `Kiro ${config.kiro.auth.length + 1}`,
    auth: authType,
    refreshToken: body.refreshToken,
    ...(body.clientId ? { clientId: body.clientId } : {}),
    ...(body.clientSecret ? { clientSecret: body.clientSecret } : {}),
  }

  writeConfig({
    ...config,
    kiro: { ...config.kiro, auth: [...config.kiro.auth, newAuth] },
  })
  kiroTokenManager.clear()

  return c.json({
    auth: {
      ...newAuth,
      refreshToken: maskSecret(newAuth.refreshToken),
      ...(newAuth.clientSecret ?
        { clientSecret: maskSecret(newAuth.clientSecret) }
      : {}),
    },
  })
})

adminRoutes.delete("/api/config/kiro/auth/:id", (c) => {
  const id = c.req.param("id")
  const config = getConfig()
  writeConfig({
    ...config,
    kiro: {
      ...config.kiro,
      auth: config.kiro.auth.filter((auth) => auth.id !== id),
    },
  })
  kiroTokenManager.clear()
  return c.json({ success: true })
})

adminRoutes.put("/api/config/kiro/auth/:id/toggle-disabled", (c) => {
  const id = c.req.param("id")
  const config = getConfig()
  const auth = config.kiro.auth.find((item) => item.id === id)
  if (!auth) return c.json({ error: "Kiro auth not found" }, 404)

  writeConfig({
    ...config,
    kiro: {
      ...config.kiro,
      auth: config.kiro.auth.map((item) =>
        item.id === id ? { ...item, disabled: !item.disabled } : item,
      ),
    },
  })
  kiroTokenManager.clear()
  return c.json({ success: true })
})

adminRoutes.post("/api/config/kiro/auth/verify", async (c) => {
  try {
    kiroTokenManager.clear()
    await kiroTokenManager.getToken()
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: String(error) }, 400)
  }
})

// ── Usage ─────────────────────────────────────────────────────────────────────

adminRoutes.get("/api/usage/openai/:keyId", async (c) => {
  const keyId = c.req.param("keyId")
  const usage = await getOpenAIUsage(keyId)
  return c.json(usage)
})

adminRoutes.get("/api/usage/copilot", async (c) => {
  try {
    const usage = await getCopilotUsage()
    invalidateCopilotUsageCache()
    return c.json(usage)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

adminRoutes.post("/api/models/refresh", async (c) => {
  const body = await c.req
    .json<{ provider?: string }>()
    .catch(() => ({}) as { provider?: string })
  const providerRaw = body.provider
  const provider:
    | "openai"
    | "mimo"
    | "deepseek"
    | "copilot"
    | "claude"
    | "ollama"
    | "kiro" =
    (
      providerRaw === "openai"
      || providerRaw === "mimo"
      || providerRaw === "deepseek"
      || providerRaw === "claude"
      || providerRaw === "ollama"
      || providerRaw === "kiro"
    ) ?
      providerRaw
    : "copilot"
  try {
    switch (provider) {
      case "openai": {
        await cacheOpenAIModels()

        break
      }
      case "deepseek": {
        cacheDeepSeekModels()

        break
      }
      case "mimo": {
        await cacheMimoModels()

        break
      }
      case "claude": {
        cacheClaudeModels()

        break
      }
      case "ollama": {
        await cacheOllamaModels()

        break
      }
      case "kiro": {
        cacheKiroModels()

        break
      }
      default: {
        await cacheCopilotModels()
      }
    }
    return c.json({ success: true, models: state.models?.data ?? [] })
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

// ── GitHub Copilot Auth (legacy-style endpoints for web UI) ───────────────────

adminRoutes.post("/api/auth/copilot/start", async (c) => {
  try {
    const deviceCode = await getDeviceCode()
    return c.json(deviceCode)
  } catch (error) {
    return c.json({ error: String(error) }, 500)
  }
})

adminRoutes.post("/api/auth/copilot/poll", async (c) => {
  const deviceCodeData = await c.req.json<{
    device_code: string
    interval: number
  }>()
  const result = await pollAccessTokenOnce(deviceCodeData.device_code)

  if (result.status === "pending" || result.status === "slow_down") {
    return c.json({ status: "pending" })
  }

  if (result.status === "expired" || result.status === "denied") {
    return c.json({ status: "error" })
  }

  if (result.status === "error") {
    return c.json({ status: "error" })
  }

  // Complete: save token
  const token = result.token
  const previousToken = state.githubToken

  state.githubToken = token

  state.githubTokenMissing = false

  let user
  try {
    user = await getGitHubUser()
  } catch {
    // eslint-disable-next-line require-atomic-updates
    state.githubToken = previousToken
    return c.json({ status: "error" })
  }

  const account: Account = {
    id: user.id.toString(),
    login: user.login,
    avatarUrl: user.avatar_url,
    token,
    accountType: "individual",
    createdAt: new Date().toISOString(),
  }

  await addAccount(account)

  try {
    copilotTokenManager.clear()
    await copilotTokenManager.getToken()

    // Cache models after auth
    await cacheCopilotModels()
  } catch {
    // ignore
  }

  return c.json({ status: "complete", username: user.login })
})

// ── Provider Switch ───────────────────────────────────────────────────────────

type SwitchProvider =
  | "copilot"
  | "openai"
  | "deepseek"
  | "mimo"
  | "claude"
  | "ollama"
  | "kiro"

function validateProviderSwitch(
  provider: SwitchProvider,
  config: ReturnType<typeof getConfig>,
): string | null {
  if (
    provider === "copilot"
    && (!config.accounts || config.accounts.length === 0)
  ) {
    return "无法切换到 GitHub Copilot：未配置任何 GitHub 账号，请先在上方 GitHub 账号 中添加账号。"
  }
  if (provider === "openai" && config.openai.keys.length === 0) {
    return "无法切换到 OpenAI：未配置任何 API Key，请先在 OpenAI 卡片中添加 Key。"
  }
  if (provider === "deepseek" && config.deepseek.keys.length === 0) {
    return "无法切换到 DeepSeek：未配置任何 API Key，请先在 DeepSeek 卡片中添加 Key。"
  }
  if (provider === "mimo" && config.mimo.keys.length === 0) {
    return "无法切换到 XiaoMiMo：未配置任何 API Key，请先在 XiaoMiMo 卡片中添加 Key。"
  }
  if (provider === "claude") {
    const claudeStatus = getClaudeCredentialsStatus()
    if (!claudeStatus.available) {
      return "无法切换到 Claude Direct：未找到认证凭证，请先在终端运行 `claude login` 登录。"
    }
    if (claudeStatus.expired) {
      return "无法切换到 Claude Direct：认证凭证已过期，请重新运行 `claude login` 登录。"
    }
  }
  if (provider === "kiro" && !hasKiroAuthConfig()) {
    return "无法切换到 Kiro：未配置 Kiro 认证，请先在 Kiro 卡片中添加认证或设置 KIRO_AUTH_TOKEN。"
  }
  // ollama: no credentials needed
  return null
}

adminRoutes.post("/api/provider/switch", async (c) => {
  const { provider } = await c.req.json<{ provider: SwitchProvider }>()
  const config = getConfig()

  const validationError = validateProviderSwitch(provider, config)
  if (validationError) {
    return c.json({ error: validationError }, 400)
  }

  state.provider = provider
  writeConfig({ ...config, activeProvider: provider })

  switch (provider) {
    case "openai": {
      const activeKey = config.openai.keys.find(
        (k) => k.id === config.openai.activeKeyId,
      )
      if (activeKey) state.openaiApiKey = activeKey.key

      break
    }
    case "deepseek": {
      const activeKey = config.deepseek.keys.find(
        (k) => k.id === config.deepseek.activeKeyId,
      )
      if (activeKey) state.deepseekApiKey = activeKey.key

      break
    }
    case "mimo": {
      const activeKey = config.mimo.keys.find(
        (k) => k.id === config.mimo.activeKeyId,
      )
      if (activeKey) state.mimoApiKey = activeKey.key

      break
    }
    // No default
  }

  try {
    switch (provider) {
      case "openai": {
        await cacheOpenAIModels()

        break
      }
      case "deepseek": {
        cacheDeepSeekModels()

        break
      }
      case "mimo": {
        await cacheMimoModels()

        break
      }
      case "claude": {
        cacheClaudeModels()

        break
      }
      case "ollama": {
        await cacheOllamaModels()

        break
      }
      case "kiro": {
        cacheKiroModels()

        break
      }
      default: {
        await cacheCopilotModels()
      }
    }
  } catch {
    // ignore
  }

  return c.json({ success: true, provider })
})

// ── Apply Env Vars ────────────────────────────────────────────────────────────

adminRoutes.post("/api/apply-env", (c) => {
  const port = state.port
  const base = `http://localhost:${port}`
  const mainModel = getMainModel()
  const smallModel = getSmallModelForProvider()

  const vars: Record<string, string> = {
    ANTHROPIC_BASE_URL: base,
    ANTHROPIC_AUTH_TOKEN: "dummy",
    ANTHROPIC_MODEL: mainModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: mainModel,
    ANTHROPIC_SMALL_FAST_MODEL: smallModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: smallModel,
    DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    OPENAI_BASE_URL: `${base}/v1`,
    OPENAI_API_KEY: "dummy",
  }

  const result = applyEnvVarsToSystem(vars)
  return c.json(result)
})

adminRoutes.post("/api/clear-env", (c) => {
  const keys = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "OPENAI_BASE_URL",
    "OPENAI_API_KEY",
  ]

  const result = clearEnvVarsFromSystem(keys)
  return c.json(result)
})

// ── Account Management ─────────────────────────────────────────────────────────

// Get all accounts
adminRoutes.get("/api/accounts", async (c) => {
  const data = await getAccounts()

  const safeAccounts = data.accounts.map((account) => ({
    id: account.id,
    login: account.login,
    avatarUrl: account.avatarUrl,
    accountType: account.accountType,
    createdAt: account.createdAt,
    isActive: account.id === data.activeAccountId,
  }))

  return c.json({
    activeAccountId: data.activeAccountId,
    accounts: safeAccounts,
  })
})

// Get current active account
adminRoutes.get("/api/accounts/active", async (c) => {
  const account = await getActiveAccount()

  if (!account) {
    return c.json({ account: null })
  }

  return c.json({
    account: {
      id: account.id,
      login: account.login,
      avatarUrl: account.avatarUrl,
      accountType: account.accountType,
      createdAt: account.createdAt,
    },
  })
})

// Switch to a different account
adminRoutes.post("/api/accounts/:id/activate", async (c) => {
  const accountId = c.req.param("id")

  const account = await setActiveAccount(accountId)

  if (!account) {
    return c.json(
      {
        error: {
          message: "Account not found",
          type: "not_found",
        },
      },
      404,
    )
  }

  state.githubToken = account.token
  state.accountType = account.accountType

  let copilotWarning: string | undefined
  try {
    copilotTokenManager.clear()
    await copilotTokenManager.getToken()
    // Refresh model list after switching account to ensure correct models are shown
    state.models = undefined
    await cacheCopilotModels()
  } catch {
    copilotWarning =
      "该账号没有 GitHub Copilot 订阅，无法获取 Copilot Token。账号已切换，但无法使用 Copilot 功能。"
  }

  return c.json({
    success: true,
    warning: copilotWarning,
    account: {
      id: account.id,
      login: account.login,
      avatarUrl: account.avatarUrl,
      accountType: account.accountType,
    },
  })
})

// Delete an account
adminRoutes.delete("/api/accounts/:id", async (c) => {
  const accountId = c.req.param("id")

  const removed = await removeAccount(accountId)

  if (!removed) {
    return c.json(
      {
        error: {
          message: "Account not found",
          type: "not_found",
        },
      },
      404,
    )
  }

  const activeAccount = await getActiveAccount()
  if (activeAccount) {
    state.githubToken = activeAccount.token
    state.accountType = activeAccount.accountType

    try {
      copilotTokenManager.clear()
      await copilotTokenManager.getToken()
    } catch {
      // Ignore refresh errors on delete
    }
  } else {
    state.githubToken = undefined
    copilotTokenManager.clear()
  }

  return c.json({ success: true })
})

// Initiate device code flow
adminRoutes.post("/api/auth/device-code", async (c) => {
  try {
    const response = await getDeviceCode()

    return c.json({
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      expiresIn: response.expires_in,
      interval: response.interval,
    })
  } catch {
    return c.json(
      {
        error: {
          message: "Failed to get device code",
          type: "auth_error",
        },
      },
      500,
    )
  }
})

interface PollRequestBody {
  deviceCode: string
  interval: number
  accountType?: string
}

type CreateAccountResult =
  | { success: true; account: Account }
  | { success: false; error: string }

/* eslint-disable require-atomic-updates */
async function createAccountFromToken(
  token: string,
  accountType: string,
): Promise<CreateAccountResult> {
  const previousToken = state.githubToken
  state.githubToken = token

  let user
  try {
    user = await getGitHubUser()
  } catch {
    state.githubToken = previousToken
    return { success: false, error: "Failed to get user info" }
  }

  const resolvedAccountType =
    accountType === "business" || accountType === "enterprise" ?
      accountType
    : "individual"

  const account: Account = {
    id: user.id.toString(),
    login: user.login,
    avatarUrl: user.avatar_url,
    token,
    accountType: resolvedAccountType,
    createdAt: new Date().toISOString(),
  }

  const dataBefore = await getAccounts()
  const isFirstAccount = !dataBefore.activeAccountId

  await addAccount(account)

  // Only switch active token if this is the first account (addAccount auto-activates it)
  if (isFirstAccount) {
    state.githubToken = token
    state.accountType = account.accountType

    try {
      copilotTokenManager.clear()
      await copilotTokenManager.getToken()
    } catch {
      // Continue even if Copilot token fails
    }
  }

  return { success: true, account }
}
/* eslint-enable require-atomic-updates */

// Poll for access token
adminRoutes.post("/api/auth/poll", async (c) => {
  const body = await c.req.json<PollRequestBody>()

  if (!body.deviceCode) {
    return c.json(
      {
        error: { message: "deviceCode is required", type: "validation_error" },
      },
      400,
    )
  }

  const result = await pollAccessTokenOnce(body.deviceCode)

  if (result.status === "pending") {
    return c.json({ pending: true, message: "Waiting for user authorization" })
  }

  if (result.status === "slow_down") {
    return c.json({
      pending: true,
      slowDown: true,
      interval: result.interval,
      message: "Rate limited, please slow down",
    })
  }

  if (result.status === "expired") {
    return c.json(
      {
        error: {
          message: "Device code expired. Please start over.",
          type: "expired",
        },
      },
      400,
    )
  }

  if (result.status === "denied") {
    return c.json(
      {
        error: { message: "Authorization was denied by user.", type: "denied" },
      },
      400,
    )
  }

  if (result.status === "error") {
    return c.json({ error: { message: result.error, type: "auth_error" } }, 500)
  }

  const accountResult = await createAccountFromToken(
    result.token,
    body.accountType ?? "individual",
  )

  if (!accountResult.success) {
    return c.json(
      { error: { message: accountResult.error, type: "auth_error" } },
      500,
    )
  }

  return c.json({
    success: true,
    account: {
      id: accountResult.account.id,
      login: accountResult.account.login,
      avatarUrl: accountResult.account.avatarUrl,
      accountType: accountResult.account.accountType,
    },
  })
})

// Get current auth status
adminRoutes.get("/api/auth/status", async (c) => {
  const activeAccount = await getActiveAccount()

  return c.json({
    authenticated:
      Boolean(state.githubToken) && copilotTokenManager.hasValidToken(),
    hasAccounts: Boolean(activeAccount),
    activeAccount:
      activeAccount ?
        {
          id: activeAccount.id,
          login: activeAccount.login,
          avatarUrl: activeAccount.avatarUrl,
          accountType: activeAccount.accountType,
        }
      : null,
  })
})

// ── Claude Direct ─────────────────────────────────────────────────────────────

adminRoutes.get("/api/claude/credentials-status", (c) => {
  return c.json(getClaudeCredentialsStatus())
})

// ── Model Mapping ─────────────────────────────────────────────────────────────

adminRoutes.get("/api/model-mappings", (c) => {
  const config = getConfig()
  return c.json({ modelMapping: config.modelMapping ?? {} })
})

adminRoutes.put("/api/model-mappings/:from", async (c) => {
  const from = c.req.param("from")
  const body = await c.req.json<{ to: string }>()

  if (!body.to || typeof body.to !== "string") {
    return c.json(
      {
        error: { message: '"to" field is required', type: "validation_error" },
      },
      400,
    )
  }

  const config = getConfig()
  const modelMapping = { ...config.modelMapping, [from]: body.to }
  await saveConfig({ ...config, modelMapping })
  return c.json({ success: true, from, to: body.to })
})

adminRoutes.delete("/api/model-mappings/:from", async (c) => {
  const from = c.req.param("from")
  const config = getConfig()

  if (!config.modelMapping || !(from in config.modelMapping)) {
    return c.json(
      { error: { message: "Mapping not found", type: "not_found" } },
      404,
    )
  }

  const { [from]: _removed, ...rest } = config.modelMapping
  await saveConfig({ ...config, modelMapping: rest })
  return c.json({ success: true })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (!key || key.length < 8) return "sk-..."
  return `sk-...${key.slice(-4)}`
}

function isMaskedKey(key: string): boolean {
  return key.startsWith("sk-...") || key === "sk-..."
}

function maskSecret(secret: string): string {
  if (!secret || secret.length < 8) return "***"
  return `***${secret.slice(-4)}`
}
