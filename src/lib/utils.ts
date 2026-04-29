import consola from "consola"

import {
  getCopilotModels,
  getModels,
  getDeepSeekModels,
  getMimoModels,
  getOllamaModels,
  getOpenAIModels,
} from "~/services/copilot/get-models"
import { getVSCodeVersion } from "~/services/get-vscode-version"
import { getKiroModels } from "~/services/kiro/models"

import { state } from "./state"

export const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined

export async function cacheModels(): Promise<void> {
  const models = await getModels()
  state.models = models
}

export async function cacheCopilotModels(): Promise<void> {
  const models = await getCopilotModels()
  state.models = models
}

export async function cacheOpenAIModels(): Promise<void> {
  const models = await getOpenAIModels()
  state.models = models
}

export function cacheDeepSeekModels(): void {
  const models = getDeepSeekModels()
  state.models = models
}

export async function cacheMimoModels(): Promise<void> {
  const models = await getMimoModels()
  state.models = models
}

export async function cacheOllamaModels(): Promise<void> {
  const models = await getOllamaModels()
  state.models = models
}

export function cacheKiroModels(): void {
  const models = getKiroModels()
  state.models = models
}

export function cacheClaudeModels(): void {
  // Claude Direct uses a static model list - no API call needed
  const claudeModels = [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-opus-4-5",
    "claude-sonnet-4-5",
  ]
  state.models = {
    object: "list",
    data: claudeModels.map((id) => ({
      id,
      name: id,
      object: "model",
      vendor: "anthropic",
      version: id,
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        family: "claude",
        object: "model_capabilities",
        type: "chat",
        tokenizer: "claude",
        limits: { max_prompt_tokens: 200000, max_output_tokens: 8192 },
        supports: {
          streaming: true,
          tool_calls: true,
          parallel_tool_calls: true,
          structured_outputs: true,
          adaptive_thinking: false,
        },
      },
      supported_endpoints: ["/v1/messages"],
    })),
  }
}

export const cacheVSCodeVersion = async () => {
  const response = await getVSCodeVersion()
  state.vsCodeVersion = response

  consola.info(`Using VSCode version: ${response}`)
}
