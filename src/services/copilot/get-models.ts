import {
  copilotBaseUrl,
  copilotHeaders,
  MIMO_BASE_URL,
  OPENAI_BASE_URL,
  ollamaBaseUrl,
} from "~/lib/api-config"
import { getConfig } from "~/lib/config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { fetchCopilotWithRetry } from "~/services/copilot/request"
import { getKiroModels } from "~/services/kiro/models"

export const getModels = async () => {
  if (state.provider === "openai") {
    return getOpenAIModels()
  }
  if (state.provider === "deepseek") {
    return getDeepSeekModels()
  }
  if (state.provider === "mimo") {
    return getMimoModels()
  }
  if (state.provider === "claude") {
    // Claude uses a static model list via cacheClaudeModels()
    // Return current cached state or empty list
    return state.models ?? { object: "list", data: [] }
  }
  if (state.provider === "ollama") {
    return getOllamaModels()
  }
  if (state.provider === "kiro") {
    return getKiroModels()
  }
  return getCopilotModels()
}

export const getCopilotModels = async () => {
  const response = await fetchCopilotWithRetry({
    url: `${copilotBaseUrl(state)}/models`,
    init: {},
    buildHeaders: () => copilotHeaders(state),
  })

  if (!response.ok) throw new HTTPError("Failed to get models", response)

  return (await response.json()) as ModelsResponse
}

export const getOpenAIModels = async () => {
  const response = await fetch(`${OPENAI_BASE_URL}/models`, {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.openaiApiKey}`,
    },
  })

  if (!response.ok) throw new HTTPError("Failed to get OpenAI models", response)

  const raw = (await response.json()) as { data: Array<{ id: string }> }

  // Filter to only chat/completions-compatible models, exclude non-LLM ones
  const excludePatterns = [
    /embedding/i,
    /audio/i,
    /tts/i,
    /whisper/i,
    /dall-e/i,
    /image/i,
    /moderation/i,
    /babbage/i,
    /davinci/i,
    /ada/i,
    /curie/i,
  ]

  const filteredModels = raw.data.filter(
    (m) => !excludePatterns.some((p) => p.test(m.id)),
  )

  const models: ModelsResponse = {
    object: "list",
    data: filteredModels.map((m) => ({
      id: m.id,
      name: m.id,
      object: "model",
      vendor: "openai",
      version: m.id,
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        family: "openai",
        object: "model_capabilities",
        type: "chat",
        tokenizer: "cl100k_base",
        limits: {},
        supports: {
          tool_calls: true,
          parallel_tool_calls: true,
          streaming: true,
          structured_outputs: true,
        },
      },
      supported_endpoints: ["/chat/completions"],
    })),
  }

  return models
}

export const getDeepSeekModels = () => {
  const models: ModelsResponse = {
    object: "list",
    data: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    ].map((m) => ({
      id: m.id,
      name: m.label,
      object: "model",
      vendor: "deepseek",
      version: m.id,
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        family: "deepseek",
        object: "model_capabilities",
        type: "chat",
        tokenizer: "cl100k_base",
        limits: { max_prompt_tokens: 65536, max_output_tokens: 8192 },
        supports: {
          tool_calls: true,
          parallel_tool_calls: false,
          streaming: true,
          structured_outputs: false,
        },
      },
      supported_endpoints: ["/v1/messages"],
    })),
  }
  return models
}

export const getMimoModels = async () => {
  const response = await fetch(`${MIMO_BASE_URL}/models`, {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${state.mimoApiKey}`,
    },
  })

  if (!response.ok) throw new HTTPError("Failed to get MiMo models", response)

  const raw = (await response.json()) as { data: Array<{ id: string }> }

  // Filter to only chat/completions-compatible models
  const excludePatterns = [
    /embedding/i,
    /audio/i,
    /tts/i,
    /whisper/i,
    /image/i,
    /moderation/i,
  ]

  const filteredModels = raw.data.filter(
    (m) => !excludePatterns.some((p) => p.test(m.id)),
  )

  const models: ModelsResponse = {
    object: "list",
    data: filteredModels.map((m) => ({
      id: m.id,
      name: m.id,
      object: "model",
      vendor: "mimo",
      version: m.id,
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        family: "mimo",
        object: "model_capabilities",
        type: "chat",
        tokenizer: "cl100k_base",
        limits: {},
        supports: {
          tool_calls: true,
          parallel_tool_calls: true,
          streaming: true,
          structured_outputs: false,
        },
      },
      supported_endpoints: ["/chat/completions"],
    })),
  }

  return models
}

export const getOllamaModels = async () => {
  const response = await fetch(`${ollamaBaseUrl()}/api/tags`)

  if (!response.ok) throw new HTTPError("Failed to get Ollama models", response)

  const raw = (await response.json()) as {
    models: Array<{
      name: string
      size: number
      details?: Record<string, unknown>
    }>
  }

  // Filter out embedding models
  const excludePatterns = [/embed/i]

  const filteredModels = raw.models.filter(
    (m) => !excludePatterns.some((p) => p.test(m.name)),
  )

  const config = getConfig()
  const apiMode = config.ollama.apiMode ?? "anthropic"
  const supportedEndpoints =
    apiMode === "anthropic" ? ["/v1/messages"] : ["/chat/completions"]

  const models: ModelsResponse = {
    object: "list",
    data: filteredModels.map((m) => ({
      id: m.name,
      name: m.name,
      object: "model",
      vendor: "ollama",
      version: m.name,
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        family: "ollama",
        object: "model_capabilities",
        type: "chat",
        tokenizer: "cl100k_base",
        limits: {},
        supports: {
          tool_calls: true,
          parallel_tool_calls: false,
          streaming: true,
          structured_outputs: false,
        },
      },
      supported_endpoints: supportedEndpoints,
    })),
  }

  return models
}

export interface ModelsResponse {
  data: Array<Model>
  object: string
}

interface ModelLimits {
  max_context_window_tokens?: number
  max_output_tokens?: number
  max_prompt_tokens?: number
  max_inputs?: number
}

interface ModelSupports {
  max_thinking_budget?: number
  min_thinking_budget?: number
  tool_calls?: boolean
  parallel_tool_calls?: boolean
  dimensions?: boolean
  streaming?: boolean
  structured_outputs?: boolean
  vision?: boolean
  adaptive_thinking?: boolean
}

interface ModelCapabilities {
  family: string
  limits: ModelLimits
  object: string
  supports: ModelSupports
  tokenizer: string
  type: string
}

export interface Model {
  capabilities: ModelCapabilities
  id: string
  model_picker_enabled: boolean
  name: string
  object: string
  preview: boolean
  vendor: string
  version: string
  policy?: {
    state: string
    terms: string
  }
  supported_endpoints?: Array<string>
}
