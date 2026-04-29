import { randomUUID } from "node:crypto"

import type { State } from "./state"

import { getConfig } from "./config"

export const standardHeaders = () => ({
  "content-type": "application/json",
  accept: "application/json",
})

export const OPENAI_BASE_URL = "https://api.openai.com/v1"
export const DEEPSEEK_ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
export const MIMO_BASE_URL = "https://api.xiaomimimo.com/v1"
export const OLLAMA_BASE_URL = "http://localhost:11434"

export const ollamaBaseUrl = (): string => {
  const config = getConfig()
  return config.ollama.baseUrl
}

export const apiBaseUrl = (state: State): string => {
  if (state.provider === "openai") {
    return OPENAI_BASE_URL
  }
  if (state.provider === "mimo") {
    return MIMO_BASE_URL
  }
  return copilotBaseUrl(state)
}

export const apiHeaders = (
  state: State,
  vision: boolean = false,
): Record<string, string> => {
  if (state.provider === "openai") {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${state.openaiApiKey}`,
    }
  }
  if (state.provider === "mimo") {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${state.mimoApiKey}`,
    }
  }
  return copilotHeaders(state, vision)
}

const COPILOT_VERSION = "0.37.6"
const EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`
const USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`

const API_VERSION = "2025-10-01"

export const copilotBaseUrl = (state: State) =>
  state.accountType === "individual" ?
    "https://api.githubcopilot.com"
  : `https://api.${state.accountType}.githubcopilot.com`
export const copilotHeaders = (state: State, vision: boolean = false) => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${state.copilotToken}`,
    "content-type": standardHeaders()["content-type"],
    "copilot-integration-id": "vscode-chat",
    "editor-version": `vscode/${state.vsCodeVersion}`,
    "editor-plugin-version": EDITOR_PLUGIN_VERSION,
    "user-agent": USER_AGENT,
    "openai-intent": "conversation-agent",
    "x-github-api-version": API_VERSION,
    "x-request-id": randomUUID(),
    "x-vscode-user-agent-library-version": "electron-fetch",
  }

  if (vision) headers["copilot-vision-request"] = "true"

  return headers
}

export const prepareSubagentHeaders = (
  sessionId: string | undefined,
  isSubagent: boolean,
  headers: Record<string, string>,
): void => {
  if (isSubagent) {
    headers["x-initiator"] = "agent"
    headers["x-interaction-type"] = "conversation-subagent"
  }

  if (sessionId) {
    headers["x-interaction-id"] = sessionId
  }
}

export const GITHUB_API_BASE_URL = "https://api.github.com"
export const githubHeaders = (state: State) => ({
  ...standardHeaders(),
  authorization: `token ${state.githubToken}`,
  "editor-version": `vscode/${state.vsCodeVersion}`,
  "editor-plugin-version": EDITOR_PLUGIN_VERSION,
  "user-agent": USER_AGENT,
  "x-github-api-version": API_VERSION,
  "x-vscode-user-agent-library-version": "electron-fetch",
})

export const GITHUB_BASE_URL = "https://github.com"
export const GITHUB_CLIENT_ID = "Iv1.b507a08c87ecfe98"
export const GITHUB_APP_SCOPES = ["read:user"].join(" ")
