import type { ModelsResponse } from "~/services/copilot/get-models"

export interface KeyStatus {
  exhausted: boolean
  exhaustedAt?: Date
}

export interface ProviderSwitchLogEntry {
  timestamp: Date
  from: string
  to: string
  reason: string
  oldModel: string
  newModel: string
}

export interface State {
  githubToken?: string
  copilotToken?: string

  accountType: string
  models?: ModelsResponse
  vsCodeVersion?: string

  rateLimitWait: boolean
  showToken: boolean

  // Rate limiting configuration
  rateLimitSeconds?: number
  lastRequestTimestamp?: number
  verbose: boolean

  // Provider management
  provider:
    | "openai"
    | "copilot"
    | "deepseek"
    | "mimo"
    | "claude"
    | "ollama"
    | "kiro"
  openaiApiKey?: string
  deepseekApiKey?: string
  mimoApiKey?: string
  port: number

  keyStatus: Map<string, KeyStatus>
  requestCountPerKey: Map<string, number>
  providerSwitchLog: Array<ProviderSwitchLogEntry>
  isSwitching: boolean
  githubTokenMissing: boolean
}

export const state: State = {
  accountType: "individual",
  rateLimitWait: false,
  showToken: false,
  verbose: false,

  provider: "copilot",
  port: 4141,

  keyStatus: new Map(),
  requestCountPerKey: new Map(),
  providerSwitchLog: [],
  isSwitching: false,
  githubTokenMissing: false,
}
