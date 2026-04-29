import consola from "consola"
import { events } from "fetch-event-stream"

import type { SubagentMarker } from "~/routes/messages/subagent-marker"

import {
  copilotHeaders,
  copilotBaseUrl,
  prepareSubagentHeaders,
  MIMO_BASE_URL,
  OPENAI_BASE_URL,
  ollamaBaseUrl,
} from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { fetchCopilotWithRetry } from "~/services/copilot/request"

interface ChatCompletionsOptions {
  initiator?: "agent" | "user"
  subagentMarker?: SubagentMarker | null
  sessionId?: string
}

function getNonCopilotBaseUrlAndAuth(): {
  baseUrl: string
  authKey: string | undefined
} {
  if (state.provider === "mimo") {
    return { baseUrl: MIMO_BASE_URL, authKey: state.mimoApiKey }
  }
  if (state.provider === "ollama") {
    // ollamaBaseUrl() returns root URL (e.g. http://localhost:11434), need /v1 prefix
    return { baseUrl: `${ollamaBaseUrl()}/v1`, authKey: undefined }
  }
  return { baseUrl: OPENAI_BASE_URL, authKey: state.openaiApiKey }
}

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
  options: ChatCompletionsOptions = {},
) => {
  const enableVision = payload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  const lastMessage = payload.messages.at(-1)
  const isAgentCall =
    lastMessage !== undefined
    && (lastMessage.role === "assistant" || lastMessage.role === "tool")

  const initiator = options.initiator ?? (isAgentCall ? "agent" : "user")

  const isMimo = state.provider === "mimo"
  const isOpenAI = state.provider === "openai"
  const isOllama = state.provider === "ollama"

  if (state.provider === "kiro") {
    throw new Error(
      "Kiro chat completions must be handled before createChatCompletions",
    )
  }

  if (isMimo || isOpenAI || isOllama) {
    // For non-Copilot providers, use standard fetch with appropriate base URL and auth
    const { baseUrl, authKey } = getNonCopilotBaseUrlAndAuth()

    let sendPayload = payload
    if (isMimo) {
      // MiMo API bug: empty array content causes errors (e.g. tool messages with no content).
      // Replace empty array content with a single empty string to avoid API errors.
      sendPayload = {
        ...payload,
        messages: payload.messages.map((msg) => {
          if (Array.isArray(msg.content) && msg.content.length === 0) {
            return { ...msg, content: "" }
          }
          return msg
        }),
      }
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    }
    if (authKey !== undefined) {
      headers.authorization = `Bearer ${authKey}`
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(sendPayload),
    })

    if (!response.ok) {
      consola.error("Failed to create chat completions", response)
      throw new HTTPError("Failed to create chat completions", response)
    }

    if (payload.stream) {
      return events(response)
    }

    return (await response.json()) as ChatCompletionResponse
  }

  // Copilot provider: use Copilot-specific headers and retry logic
  const buildHeaders = () => {
    const headers: Record<string, string> = {
      ...copilotHeaders(state, enableVision),
      "X-Initiator": initiator,
    }
    prepareSubagentHeaders(
      options.sessionId,
      Boolean(options.subagentMarker),
      headers,
    )
    return headers
  }

  const response = await fetchCopilotWithRetry({
    url: `${copilotBaseUrl(state)}/chat/completions`,
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    buildHeaders,
  })

  if (!response.ok) {
    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

export interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
  reasoning_text?: string | null
  reasoning_opaque?: string | null
}

export interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  reasoning_text?: string | null
  reasoning_opaque?: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
  thinking_budget?: number
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
  reasoning_text?: string | null
  reasoning_opaque?: string | null
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
