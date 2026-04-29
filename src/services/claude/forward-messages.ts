import { events } from "fetch-event-stream"

import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"

import { DEEPSEEK_ANTHROPIC_BASE_URL, ollamaBaseUrl } from "~/lib/api-config"
import { getClaudeOAuthToken } from "~/lib/claude-credentials"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

export type MessagesStream = ReturnType<typeof events>
export type ForwardMessagesReturn = AnthropicResponse | MessagesStream

const ANTHROPIC_API_BASE = "https://api.anthropic.com"
const ANTHROPIC_VERSION = "2023-06-01"

export const forwardMessages = async (
  payload: AnthropicMessagesPayload,
  options: {
    anthropicBetaHeader?: string
  } = {},
): Promise<ForwardMessagesReturn> => {
  const token = getClaudeOAuthToken()

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "anthropic-version": ANTHROPIC_VERSION,
  }

  if (options.anthropicBetaHeader) {
    headers["anthropic-beta"] = options.anthropicBetaHeader
  }

  const response = await fetch(`${ANTHROPIC_API_BASE}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new HTTPError("Claude Direct request failed", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as AnthropicResponse
}

export const forwardMessagesToOllama = async (
  payload: AnthropicMessagesPayload,
): Promise<ForwardMessagesReturn> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: "Bearer ollama",
    "anthropic-version": ANTHROPIC_VERSION,
  }

  const response = await fetch(`${ollamaBaseUrl()}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new HTTPError("Ollama request failed", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as AnthropicResponse
}

export const forwardMessagesToDeepSeek = async (
  payload: AnthropicMessagesPayload,
): Promise<ForwardMessagesReturn> => {
  const apiKey = state.deepseekApiKey

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "anthropic-version": ANTHROPIC_VERSION,
  }

  const response = await fetch(`${DEEPSEEK_ANTHROPIC_BASE_URL}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new HTTPError("DeepSeek request failed", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as AnthropicResponse
}
