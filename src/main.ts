#!/usr/bin/env node

import consola from "consola"
import { serve, type ServerHandler } from "srvx"

import { getActiveAccount } from "./lib/accounts"
import { isClaudeCredentialsAvailable } from "./lib/claude-credentials"
import {
  mergeConfigWithDefaults,
  getMainModel,
  getSmallModelForProvider,
} from "./lib/config"
import { copilotTokenManager } from "./lib/copilot-token-manager"
import { ensurePaths } from "./lib/paths"
import { initProxyFromEnv } from "./lib/proxy"
import { state } from "./lib/state"
import {
  cacheModels,
  cacheOpenAIModels,
  cacheDeepSeekModels,
  cacheMimoModels,
  cacheClaudeModels,
  cacheOllamaModels,
  cacheKiroModels,
  cacheVSCodeVersion,
} from "./lib/utils"
import { hasKiroAuthConfig } from "./services/kiro/auth-config"

// Configuration from environment variables
const PORT = Number.parseInt(process.env.PORT || "4141", 10)
const VERBOSE = process.env.VERBOSE === "true" || process.env.DEBUG === "true"
const RATE_LIMIT =
  process.env.RATE_LIMIT ?
    Number.parseInt(process.env.RATE_LIMIT, 10)
  : undefined
const RATE_LIMIT_WAIT = process.env.RATE_LIMIT_WAIT === "true"
const SHOW_TOKEN = process.env.SHOW_TOKEN === "true"
const PROXY_ENV = process.env.PROXY_ENV === "true"

async function initWithAccount(): Promise<void> {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    switch (state.provider) {
      case "claude": {
        initClaudeDirect()

        break
      }
      case "deepseek": {
        initDeepSeek()

        break
      }
      case "ollama": {
        await initOllama()

        break
      }
      case "kiro": {
        initKiro()

        break
      }
      default: {
        consola.warn("No account configured. Visit /admin to add an account.")
        state.githubTokenMissing = true
      }
    }
    return
  }

  state.githubToken = activeAccount.token

  state.accountType = activeAccount.accountType
  consola.info(`Logged in as ${activeAccount.login}`)

  if (state.showToken) {
    consola.info("GitHub token:", activeAccount.token)
  }

  // Ollama provider doesn't need Copilot token or GitHub account
  if (state.provider === "ollama") {
    await initOllama()
    return
  }

  // DeepSeek provider doesn't need Copilot token or GitHub account
  if (state.provider === "deepseek") {
    initDeepSeek()
    return
  }

  // Kiro provider doesn't need Copilot token or GitHub account
  if (state.provider === "kiro") {
    initKiro()
    return
  }

  await copilotTokenManager.getToken()

  try {
    await cacheModels()
    consola.info(
      `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
    )
  } catch {
    consola.warn(
      "Failed to cache models on startup. Visit /admin to configure the provider and refresh models manually.",
    )
  }

  // Cache other providers' models in background
  if (state.provider !== "openai") {
    cacheOpenAIModels().catch(() => {
      /* no OpenAI key */
    })
  }
  if (state.provider === "copilot") {
    cacheMimoModels().catch(() => {
      /* no MiMo key */
    })
  }
}

function initClaudeDirect(): void {
  const claudeAvailable = isClaudeCredentialsAvailable()
  if (claudeAvailable) {
    consola.info("Claude Direct: credentials found, ready to use.")
  } else {
    consola.warn(
      "Claude Direct: no credentials found. Please run `claude login` to authenticate.",
    )
  }
  cacheClaudeModels()
  consola.info(
    `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
  )
}

function initDeepSeek(): void {
  if (state.deepseekApiKey) {
    consola.info("DeepSeek: API key configured, ready to use.")
  } else {
    consola.warn(
      "DeepSeek: no API key configured. Please add a key via /admin.",
    )
  }
  try {
    cacheDeepSeekModels()
  } catch {
    consola.warn("Failed to cache DeepSeek models on startup.")
  }
}

async function initOllama(): Promise<void> {
  try {
    await cacheOllamaModels()
    consola.info(
      `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
    )
  } catch {
    consola.warn(
      "Failed to cache Ollama models on startup. Make sure Ollama is running, or visit /admin to refresh models manually.",
    )
  }
}

function initKiro(): void {
  if (hasKiroAuthConfig()) {
    consola.info("Kiro: auth configured, ready to refresh token on demand.")
  } else {
    consola.warn(
      "Kiro: no auth configured. Add Kiro auth via /admin or KIRO_AUTH_TOKEN.",
    )
  }
  cacheKiroModels()
  consola.info(
    `Available models: \n${state.models?.data.map((model) => `- ${model.id}`).join("\n")}`,
  )
}

async function main(): Promise<void> {
  // Ensure config is merged with defaults at startup
  const config = mergeConfigWithDefaults()

  if (PROXY_ENV) {
    initProxyFromEnv()
  }

  state.verbose = VERBOSE
  if (VERBOSE) {
    consola.level = 5
    consola.info("Verbose logging enabled")
  }

  state.rateLimitSeconds = RATE_LIMIT
  state.rateLimitWait = RATE_LIMIT_WAIT
  state.showToken = SHOW_TOKEN
  state.port = PORT

  // Initialize provider from config
  state.provider = config.activeProvider

  // Initialize OpenAI key status tracking
  const activeOpenAIKey = config.openai.keys.find(
    (k) => k.id === config.openai.activeKeyId,
  )
  if (activeOpenAIKey) {
    state.openaiApiKey = activeOpenAIKey.key
    for (const key of config.openai.keys) {
      if (!state.keyStatus.has(key.id)) {
        state.keyStatus.set(key.id, { exhausted: false })
      }
      if (!state.requestCountPerKey.has(key.id)) {
        state.requestCountPerKey.set(key.id, 0)
      }
    }
  }

  // Initialize MiMo key
  const activeMimoKey = config.mimo.keys.find(
    (k) => k.id === config.mimo.activeKeyId,
  )
  if (activeMimoKey) {
    state.mimoApiKey = activeMimoKey.key
  }

  // Initialize DeepSeek key
  const activeDeepSeekKey = config.deepseek.keys.find(
    (k) => k.id === config.deepseek.activeKeyId,
  )
  if (activeDeepSeekKey) {
    state.deepseekApiKey = activeDeepSeekKey.key
  }

  await ensurePaths()
  await cacheVSCodeVersion()

  await initWithAccount()

  const serverUrl = `http://localhost:${PORT}`
  const mainModel = getMainModel()
  const smallModel = getSmallModelForProvider()

  const { server } = await import("./server")

  serve({
    fetch: server.fetch as ServerHandler,
    port: PORT,
    bun: {
      idleTimeout: 0,
    },
  })

  consola.box(
    [
      `🌐 Web Console: ${serverUrl}/admin`,
      ``,
      `Claude Code:`,
      `  ANTHROPIC_BASE_URL=${serverUrl} ANTHROPIC_AUTH_TOKEN=dummy \\`,
      `  ANTHROPIC_MODEL=${mainModel} ANTHROPIC_DEFAULT_SONNET_MODEL=${mainModel} \\`,
      `  ANTHROPIC_SMALL_FAST_MODEL=${smallModel} ANTHROPIC_DEFAULT_HAIKU_MODEL=${smallModel} \\`,
      `  DISABLE_NON_ESSENTIAL_MODEL_CALLS=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 claude`,
      ``,
      `Codex:  OPENAI_BASE_URL=${serverUrl}/v1 OPENAI_API_KEY=dummy codex`,
    ].join("\n"),
  )
}

main().catch((error: unknown) => {
  consola.error("Failed to start server:", error)
  process.exit(1)
})
