import type {
  AnthropicAssistantContentBlock,
  AnthropicMessagesPayload,
  AnthropicTool,
  AnthropicUserContentBlock,
} from "~/routes/messages/anthropic-types"
import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
} from "~/services/copilot/create-chat-completions"

import { HTTPError } from "~/lib/error"

import { forwardMessagesToKiro } from "./forward-messages"

function dataUrlToAnthropicImage(
  part: ContentPart,
): AnthropicUserContentBlock | null {
  if (part.type !== "image_url") return null
  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/u.exec(
    part.image_url.url,
  )
  if (!match) {
    throw new Error("Kiro only supports OpenAI image_url data URLs")
  }
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1] as
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp",
      data: match[2],
    },
  }
}

function openAIContentToAnthropic(
  content: Message["content"],
): string | Array<AnthropicUserContentBlock> {
  if (typeof content === "string") return content
  if (!content) return ""

  return content.flatMap((part) => {
    if (part.type === "text") {
      return [
        { type: "text", text: part.text } satisfies AnthropicUserContentBlock,
      ]
    }
    const image = dataUrlToAnthropicImage(part)
    return image ? [image] : []
  })
}

function messagesToAnthropic(
  payload: ChatCompletionsPayload,
): AnthropicMessagesPayload {
  const system = payload.messages
    .filter(
      (message) => message.role === "system" || message.role === "developer",
    )
    .map((message) =>
      typeof message.content === "string" ? message.content : "",
    )
    .filter(Boolean)
    .join("\n\n")

  const messages = payload.messages
    .filter(
      (message) => message.role !== "system" && message.role !== "developer",
    )
    .map((message) => {
      if (message.role === "assistant") {
        const content: Array<AnthropicAssistantContentBlock> = []
        if (typeof message.content === "string" && message.content) {
          content.push({ type: "text", text: message.content })
        }
        for (const toolCall of message.tool_calls ?? []) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: parseToolArguments(toolCall.function.arguments),
          })
        }
        return { role: "assistant" as const, content }
      }

      if (message.role === "tool") {
        return {
          role: "user" as const,
          content: [
            {
              type: "tool_result" as const,
              tool_use_id: message.tool_call_id ?? "unknown",
              content:
                typeof message.content === "string" ? message.content : "",
            },
          ],
        }
      }

      return {
        role: "user" as const,
        content: openAIContentToAnthropic(message.content),
      }
    })

  return {
    model: payload.model,
    max_tokens: payload.max_tokens ?? 4096,
    messages,
    ...(system ? { system } : {}),
    stream: payload.stream === true,
    ...(payload.temperature !== null && payload.temperature !== undefined ?
      { temperature: payload.temperature }
    : {}),
    ...(payload.top_p !== null && payload.top_p !== undefined ?
      { top_p: payload.top_p }
    : {}),
    tools: payload.tools?.map(
      (tool): AnthropicTool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }),
    ),
    tool_choice: mapToolChoice(payload.tool_choice),
  }
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return {}
  }
  return {}
}

function mapToolChoice(
  toolChoice: ChatCompletionsPayload["tool_choice"],
): AnthropicMessagesPayload["tool_choice"] {
  if (!toolChoice || toolChoice === "none") return undefined
  if (toolChoice === "auto") return { type: "auto" }
  if (toolChoice === "required") return { type: "any" }
  return { type: "tool", name: toolChoice.function.name }
}

function isAnthropicResponse(
  response: Awaited<ReturnType<typeof forwardMessagesToKiro>>,
): response is import("~/routes/messages/anthropic-types").AnthropicResponse {
  return "content" in response
}

function anthropicToOpenAIResponse(
  anthropic: import("~/routes/messages/anthropic-types").AnthropicResponse,
  model: string,
): ChatCompletionResponse {
  const text = anthropic.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
  const toolCalls = anthropic.content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      type: "function" as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input),
      },
    }))

  return {
    id: `chatcmpl_kiro_${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: anthropic.usage.input_tokens,
      completion_tokens: anthropic.usage.output_tokens,
      total_tokens:
        anthropic.usage.input_tokens + anthropic.usage.output_tokens,
    },
  }
}

export async function createKiroChatCompletions(
  payload: ChatCompletionsPayload,
): Promise<ChatCompletionResponse> {
  if (payload.stream) {
    throw new HTTPError(
      "Kiro provider does not support streaming /v1/chat/completions yet",
      new Response(
        "Kiro provider does not support streaming /v1/chat/completions yet",
        {
          status: 501,
        },
      ),
    )
  }

  const anthropicPayload = messagesToAnthropic(payload)
  const response = await forwardMessagesToKiro(anthropicPayload)
  if (!isAnthropicResponse(response)) {
    throw new Error(
      "Streaming Kiro response cannot be converted as non-streaming",
    )
  }
  return anthropicToOpenAIResponse(response, payload.model)
}
