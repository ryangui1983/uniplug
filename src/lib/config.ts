import consola from "consola"
import fs from "node:fs"

import { PATHS } from "./paths"
import { state } from "./state"

export interface AccountConfig {
  id: string
  login: string
  avatarUrl: string
  token: string
  accountType: "individual" | "business" | "enterprise"
  createdAt: string
}

export interface OpenAIKeyConfig {
  id: string
  key: string
  label: string
}

export interface OpenAIConfig {
  keys: Array<OpenAIKeyConfig>
  activeKeyId?: string
  mainModel: string
  smallModel: string
  passthroughModel?: boolean
}

export interface CopilotConfig {
  mainModel: string
  smallModel: string
  force: boolean
  quotaThreshold?: number
  passthroughModel?: boolean
}

export interface MimoKeyConfig {
  id: string
  key: string
  label: string
}

export interface MimoConfig {
  keys: Array<MimoKeyConfig>
  activeKeyId?: string
  mainModel: string
  smallModel: string
  passthroughModel?: boolean
}

export interface DeepSeekKeyConfig {
  id: string
  key: string
  label: string
}

export interface DeepSeekConfig {
  keys: Array<DeepSeekKeyConfig>
  activeKeyId?: string
  mainModel: string
  smallModel: string
  passthroughModel?: boolean
}

export interface ClaudeDirectConfig {
  mainModel: string
  smallModel: string
  passthroughModel: boolean
}

export interface OllamaConfig {
  baseUrl: string
  mainModel: string
  smallModel: string
  passthroughModel?: boolean
  apiMode?: "anthropic" | "openai"
}

export interface KiroAuthConfig {
  id: string
  label: string
  auth: "Social" | "IdC"
  refreshToken: string
  clientId?: string
  clientSecret?: string
  machineId?: string
  profileArn?: string
  region?: string
  disabled?: boolean
}

export interface KiroConfig {
  auth: Array<KiroAuthConfig>
  mainModel: string
  smallModel: string
  passthroughModel?: boolean
  checkUsageLimits?: boolean
  maxToolDescriptionLength?: number
}

export interface AppConfig {
  auth?: {
    apiKeys?: Array<string>
  }
  extraPrompts?: Record<string, string>
  modelReasoningEfforts?: Record<
    string,
    "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
  >
  modelMapping?: Record<string, string>
  useFunctionApplyPatch?: boolean
  compactUseSmallModel?: boolean
  // Account management
  accounts?: Array<AccountConfig>
  activeAccountId?: string | null

  activeProvider:
    | "openai"
    | "copilot"
    | "mimo"
    | "deepseek"
    | "claude"
    | "ollama"
    | "kiro"
  autoSwitch: boolean

  openai: OpenAIConfig
  copilot: CopilotConfig
  deepseek: DeepSeekConfig
  mimo: MimoConfig
  claude: ClaudeDirectConfig
  ollama: OllamaConfig
  kiro: KiroConfig
}

const gpt5ExplorationPrompt = `## Exploration and reading files
- **Think first.** Before any tool call, decide ALL files/resources you will need.
- **Batch everything.** If you need multiple files (even from different places), read them together.
- **multi_tool_use.parallel** Use multi_tool_use.parallel to parallelize tool calls and only this.
- **Only make sequential calls if you truly cannot know the next file without seeing a result first.**
- **Workflow:** (a) plan all needed reads → (b) issue one parallel batch → (c) analyze results → (d) repeat if new, unpredictable reads arise.`

const gpt5CommentaryPrompt = `# Working with the user

You interact with the user through a terminal. You have 2 ways of communicating with the users:
- Share intermediary updates in \`commentary\` channel.
- After you have completed all your work, send a message to the \`final\` channel.

## Intermediary updates

- Intermediary updates go to the \`commentary\` channel.
- User updates are short updates while you are working, they are NOT final answers.
- You use 1-2 sentence user updates to communicate progress and new information to the user as you are doing work.
- Do not begin responses with conversational interjections or meta commentary. Avoid openers such as acknowledgements ("Done —", "Got it", "Great question, ") or framing phrases.
- You provide user updates frequently, every 20s.
- Before exploring or doing substantial work, you start with a user update acknowledging the request and explaining your first step. You should include your understanding of the user request and explain what you will do. Avoid commenting on the request or using starters such as "Got it -" or "Understood -" etc.
- When exploring, e.g. searching, reading files, you provide user updates as you go, every 20s, explaining what context you are gathering and what you've learned. Vary your sentence structure when providing these updates to avoid sounding repetitive - in particular, don't start each sentence the same way.
- After you have sufficient context, and the work is substantial, you provide a longer plan (this is the only user update that may be longer than 2 sentences and can contain formatting).
- Before performing file edits of any kind, you provide updates explaining what edits you are making.
- As you are thinking, you very frequently provide updates even if not taking any actions, informing the user of your progress. You interrupt your thinking and send multiple updates in a row if thinking for more than 100 words.
- Tone of your updates MUST match your personality.`

const defaultConfig: AppConfig = {
  auth: {
    apiKeys: [],
  },
  extraPrompts: {
    "gpt-5-mini": gpt5ExplorationPrompt,
    "gpt-5.1-codex-max": gpt5ExplorationPrompt,
    "gpt-5.3-codex": gpt5CommentaryPrompt,
  },
  modelReasoningEfforts: {
    "gpt-5-mini": "low",
  },
  useFunctionApplyPatch: true,
  compactUseSmallModel: true,
  accounts: [],
  activeAccountId: null,

  activeProvider: "copilot",
  autoSwitch: true,

  openai: {
    keys: [],
    mainModel: "gpt-4o",
    smallModel: "gpt-4o-mini",
  },

  copilot: {
    mainModel: "gpt-5",
    smallModel: "gpt-5-mini",
    force: false,
    quotaThreshold: 1500,
  },

  mimo: {
    keys: [],
    mainModel: "mimo-v2-flash",
    smallModel: "mimo-v2-flash",
  },

  deepseek: {
    keys: [],
    mainModel: "deepseek-v4-pro",
    smallModel: "deepseek-v4-flash",
  },

  claude: {
    mainModel: "claude-opus-4-6",
    smallModel: "claude-haiku-4-5",
    passthroughModel: true,
  },

  ollama: {
    baseUrl: "http://localhost:11434",
    mainModel: "qwen3.5:9b",
    smallModel: "qwen3.5:9b",
    passthroughModel: true,
    apiMode: "anthropic",
  },

  kiro: {
    auth: [],
    mainModel: "claude-sonnet-4-5",
    smallModel: "claude-3-5-haiku-20241022",
    passthroughModel: false,
    checkUsageLimits: true,
    maxToolDescriptionLength: 10000,
  },
}

let cachedConfig: AppConfig | null = null

function isOldFormatConfig(config: unknown): boolean {
  if (typeof config !== "object" || config === null) return false
  const c = config as Record<string, unknown>
  // Old format has top-level smallModel or model fields without activeProvider
  return (
    typeof c["smallModel"] === "string"
    || typeof c["model"] === "string"
    || !Object.hasOwn(c, "activeProvider")
  )
}

function ensureConfigFile(): void {
  try {
    fs.accessSync(PATHS.CONFIG_PATH, fs.constants.R_OK | fs.constants.W_OK)
  } catch {
    fs.mkdirSync(PATHS.APP_DIR, { recursive: true })
    fs.writeFileSync(
      PATHS.CONFIG_PATH,
      `${JSON.stringify(defaultConfig, null, 2)}\n`,
      "utf8",
    )
    try {
      fs.chmodSync(PATHS.CONFIG_PATH, 0o600)
    } catch {
      return
    }
  }
}

function readConfigFromDisk(): AppConfig {
  ensureConfigFile()
  try {
    const raw = fs.readFileSync(PATHS.CONFIG_PATH, "utf8")
    if (!raw.trim()) {
      fs.writeFileSync(
        PATHS.CONFIG_PATH,
        `${JSON.stringify(defaultConfig, null, 2)}\n`,
        "utf8",
      )
      return defaultConfig
    }
    const parsed = JSON.parse(raw) as unknown
    if (isOldFormatConfig(parsed)) {
      consola.warn(
        "Old config format detected, resetting to default config. Please reconfigure via the web console.",
      )
      fs.writeFileSync(
        PATHS.CONFIG_PATH,
        `${JSON.stringify(defaultConfig, null, 2)}\n`,
        "utf8",
      )
      return defaultConfig
    }
    const config = parsed as AppConfig
    // Backfill mimo field if missing (config from before mimo support was added)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config.mimo) {
      config.mimo = defaultConfig.mimo
    }
    // Backfill claude field if missing (config from before claude support was added)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config.claude) {
      config.claude = defaultConfig.claude
    }
    // Backfill ollama field if missing (config from before ollama support was added)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config.ollama) {
      config.ollama = defaultConfig.ollama
    }
    // Backfill deepseek field if missing (config from before deepseek support was added)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config.deepseek) {
      config.deepseek = defaultConfig.deepseek
    }
    // Backfill kiro field if missing (config from before kiro support was added)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!config.kiro) {
      config.kiro = defaultConfig.kiro
    }
    return config
  } catch (error) {
    consola.error("Failed to read config file, using default config", error)
    return defaultConfig
  }
}

function mergeDefaultExtraPrompts(config: AppConfig): {
  mergedConfig: AppConfig
  changed: boolean
} {
  const extraPrompts = config.extraPrompts ?? {}
  const defaultExtraPrompts = defaultConfig.extraPrompts ?? {}

  const missingExtraPromptModels = Object.keys(defaultExtraPrompts).filter(
    (model) => !Object.hasOwn(extraPrompts, model),
  )

  if (missingExtraPromptModels.length === 0) {
    return { mergedConfig: config, changed: false }
  }

  return {
    mergedConfig: {
      ...config,
      extraPrompts: {
        ...defaultExtraPrompts,
        ...extraPrompts,
      },
    },
    changed: true,
  }
}

export function mergeConfigWithDefaults(): AppConfig {
  const config = readConfigFromDisk()
  const { mergedConfig, changed } = mergeDefaultExtraPrompts(config)

  if (changed) {
    try {
      fs.writeFileSync(
        PATHS.CONFIG_PATH,
        `${JSON.stringify(mergedConfig, null, 2)}\n`,
        "utf8",
      )
    } catch (writeError) {
      consola.warn(
        "Failed to write merged extraPrompts to config file",
        writeError,
      )
    }
  }

  cachedConfig = mergedConfig
  return mergedConfig
}

export function getConfig(): AppConfig {
  cachedConfig ??= readConfigFromDisk()
  return cachedConfig
}

export function writeConfig(config: AppConfig): void {
  fs.writeFileSync(
    PATHS.CONFIG_PATH,
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  )
  cachedConfig = config
}

/**
 * Save config to disk (async)
 */
export async function saveConfig(config: AppConfig): Promise<void> {
  ensureConfigFile()
  cachedConfig = config
  const content = `${JSON.stringify(config, null, 2)}\n`
  await fs.promises.writeFile(PATHS.CONFIG_PATH, content, "utf8")
}

export function invalidateConfigCache(): void {
  cachedConfig = null
}

export function getMainModel(): string {
  const config = getConfig()
  if (state.provider === "openai") {
    return config.openai.mainModel
  }
  if (state.provider === "deepseek") {
    return config.deepseek.mainModel
  }
  if (state.provider === "mimo") {
    return config.mimo.mainModel
  }
  if (state.provider === "claude") {
    return config.claude.mainModel
  }
  if (state.provider === "ollama") {
    return config.ollama.mainModel
  }
  if (state.provider === "kiro") {
    consola.log(
      "Using kiro provider, returning kiro main model from config",
      config.kiro.mainModel,
    )
    return config.kiro.mainModel
  }
  return config.copilot.mainModel
}

export function getSmallModelForProvider(): string {
  const config = getConfig()
  if (state.provider === "openai") {
    return config.openai.smallModel
  }
  if (state.provider === "deepseek") {
    return config.deepseek.smallModel
  }
  if (state.provider === "mimo") {
    return config.mimo.smallModel
  }
  if (state.provider === "claude") {
    return config.claude.smallModel
  }
  if (state.provider === "ollama") {
    return config.ollama.smallModel
  }
  if (state.provider === "kiro") {
    return config.kiro.smallModel
  }
  return config.copilot.smallModel
}

export function getSmallModel(): string {
  return getSmallModelForProvider()
}

export function getExtraPromptForModel(model: string): string {
  const config = getConfig()
  return config.extraPrompts?.[model] ?? ""
}

export function getReasoningEffortForModel(
  model: string,
): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" {
  const config = getConfig()
  const configuredEffort = config.modelReasoningEfforts?.[model]

  if (configuredEffort) {
    return configuredEffort
  }

  if (model.startsWith("gpt-5.2")) {
    return "xhigh"
  }

  if (model.startsWith("gpt-5.1")) {
    return "xhigh"
  }

  return "high"
}

export function shouldCompactUseSmallModel(): boolean {
  const config = getConfig()
  return config.compactUseSmallModel ?? true
}

export function isPassthroughModel(): boolean {
  const config = getConfig()
  if (state.provider === "openai") {
    return config.openai.passthroughModel ?? false
  }
  if (state.provider === "deepseek") {
    return config.deepseek.passthroughModel ?? false
  }
  if (state.provider === "mimo") {
    return config.mimo.passthroughModel ?? false
  }
  if (state.provider === "claude") {
    return config.claude.passthroughModel
  }
  if (state.provider === "ollama") {
    return config.ollama.passthroughModel ?? true
  }
  if (state.provider === "kiro") {
    return config.kiro.passthroughModel ?? false
  }
  return config.copilot.passthroughModel ?? false
}

export function getMappedModel(model: string): string {
  const config = getConfig()
  return config.modelMapping?.[model] ?? model
}
