import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import type { Model } from "~/services/copilot/get-models"

import {
  getMappedModel,
  getSmallModelForProvider,
  getMainModel,
  getConfig,
  shouldCompactUseSmallModel,
  getReasoningEffortForModel,
  isPassthroughModel,
} from "~/lib/config"
import { AllProvidersExhaustedError, QuotaExhaustedError } from "~/lib/error"
import { createHandlerLogger } from "~/lib/logger"
import { ensureProviderAvailable } from "~/lib/provider-switch"
import { checkRateLimit } from "~/lib/rate-limit"
import { getRootSessionId } from "~/lib/session"
import { state } from "~/lib/state"
import {
  buildErrorEvent,
  createResponsesStreamState,
  translateResponsesStreamEvent,
} from "~/routes/messages/responses-stream-translation"
import {
  translateAnthropicMessagesToResponsesPayload,
  translateResponsesResultToAnthropic,
} from "~/routes/messages/responses-translation"
import { getResponsesRequestOptions } from "~/routes/responses/utils"
import {
  forwardMessages,
  forwardMessagesToDeepSeek,
  forwardMessagesToOllama,
} from "~/services/claude/forward-messages"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
} from "~/services/copilot/create-chat-completions"
import { createMessages } from "~/services/copilot/create-messages"
import {
  createResponses,
  type ResponsesResult,
  type ResponseStreamEvent,
} from "~/services/copilot/create-responses"
import { forwardMessagesToKiro } from "~/services/kiro/forward-messages"

import {
  type AnthropicMessagesPayload,
  type AnthropicStreamState,
  type AnthropicTextBlock,
  type AnthropicTool,
  type AnthropicToolResultBlock,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"
import { translateChunkToAnthropicEvents } from "./stream-translation"
import {
  parseSubagentMarkerFromFirstUser,
  type SubagentMarker,
} from "./subagent-marker"

const logger = createHandlerLogger("messages-handler")

const compactSystemPromptStart =
  "You are a helpful AI assistant tasked with summarizing conversations"

function getLastMessagePreview(
  msg: AnthropicMessagesPayload["messages"][number] | undefined,
): string {
  if (!msg) return ""
  const c = msg.content
  if (typeof c === "string") return c.slice(-200)
  if (Array.isArray(c)) return JSON.stringify(c).slice(-200)
  return ""
}

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  const anthropicPayload = await c.req.json<AnthropicMessagesPayload>()
  logger.debug("Anthropic request payload:", JSON.stringify(anthropicPayload))

  // Ensure provider is available before processing
  try {
    await ensureProviderAvailable()
  } catch (error) {
    if (error instanceof AllProvidersExhaustedError) {
      return c.json(
        { error: { message: error.message, type: "overloaded_error" } },
        503,
      )
    }
    throw error
  }

  const subagentMarker = parseSubagentMarkerFromFirstUser(anthropicPayload)
  if (subagentMarker) {
    logger.debug("Detected Subagent marker:", JSON.stringify(subagentMarker))
  }

  const sessionId = getRootSessionId(anthropicPayload, c)
  logger.debug("Extracted session ID:", sessionId)

  // claude code and opencode compact request detection
  const isCompact = isCompactRequest(anthropicPayload)

  // fix claude code 2.0.28+ warmup request consume premium request, forcing small model if no tools are used
  // set "CLAUDE_CODE_SUBAGENT_MODEL": "you small model" also can avoid this
  const anthropicBeta = c.req.header("anthropic-beta")
  logger.debug("Anthropic Beta header:", anthropicBeta)
  const noTools = !anthropicPayload.tools || anthropicPayload.tools.length === 0

  // If current provider has passthroughModel enabled, skip model override (only apply alias mapping)
  if (!isPassthroughModel()) {
    if (anthropicBeta && noTools && !isCompact) {
      anthropicPayload.model = getSmallModelForProvider()
    } else if (isCompact) {
      logger.debug("Is compact request:", isCompact)
      anthropicPayload.model =
        shouldCompactUseSmallModel() ?
          getSmallModelForProvider()
        : getMainModel()
    } else {
      // Override model with config main model (ignore client's model field)
      anthropicPayload.model = getMainModel()
      // Merge tool_result and text blocks into tool_result
      mergeToolResultForClaude(anthropicPayload)
    }
  }

  anthropicPayload.model = getMappedModel(anthropicPayload.model)
  consola.log(
    `[Request2] provider: ${state.provider}, model: ${anthropicPayload.model}`,
  )

  consola.info(
    `[Request time:${new Date().toLocaleString()}] model: ${anthropicPayload.model}`,
  )
  const preview = getLastMessagePreview(anthropicPayload.messages.at(-1))
  if (preview) consola.log("Last message:", preview)
  const initiator = inferAnthropicInitiatorFromLastMessage(anthropicPayload)

  sanitizeOrphanToolResults(anthropicPayload)
  convertWebSearchTools(anthropicPayload)

  try {
    return await processAnthropicPayload(c, anthropicPayload, {
      anthropicBetaHeader: anthropicBeta,
      initiatorOverride: initiator,
      subagentMarker,
      sessionId,
    })
  } catch (error) {
    if (error instanceof QuotaExhaustedError) {
      logger.warn("Quota exhausted, switching provider and retrying...")
      try {
        await ensureProviderAvailable()
        // Refresh model after provider switch
        anthropicPayload.model = getMainModel()
      } catch (switchError) {
        if (switchError instanceof AllProvidersExhaustedError) {
          return c.json(
            {
              error: {
                message: switchError.message,
                type: "overloaded_error",
              },
            },
            503,
          )
        }
        throw switchError
      }
      return await processAnthropicPayload(c, anthropicPayload, {
        anthropicBetaHeader: anthropicBeta,
        initiatorOverride: initiator,
        subagentMarker,
        sessionId,
      })
    }
    throw error
  }
}

interface ProcessOptions {
  anthropicBetaHeader: string | undefined
  initiatorOverride: "agent" | "user"
  subagentMarker: SubagentMarker | null
  sessionId: string | undefined
}

async function processAnthropicPayload(
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  options: ProcessOptions,
) {
  // Claude Direct: forward request directly to api.anthropic.com
  if (state.provider === "claude") {
    return await handleWithClaudeDirect(c, anthropicPayload, {
      anthropicBetaHeader: options.anthropicBetaHeader,
    })
  }

  // DeepSeek: forward using Anthropic-compatible API
  if (state.provider === "deepseek") {
    return await handleWithDeepSeek(c, anthropicPayload)
  }

  // Ollama Anthropic mode: forward directly using Anthropic-compatible API
  // OpenAI mode: fall through to model-based routing below (supported_endpoints = ["/chat/completions"])
  if (state.provider === "ollama") {
    const ollamaCfg = getConfig().ollama
    if ((ollamaCfg.apiMode ?? "anthropic") === "anthropic") {
      return await handleWithOllama(c, anthropicPayload)
    }
  }

  if (state.provider === "kiro") {
    return await handleWithKiro(c, anthropicPayload, {
      sessionId: options.sessionId,
    })
  }

  const selectedModel = state.models?.data.find(
    (m) => m.id === anthropicPayload.model,
  )

  if (shouldUseMessagesApi(selectedModel)) {
    return await handleWithMessagesApi(c, anthropicPayload, {
      anthropicBetaHeader: options.anthropicBetaHeader,
      initiatorOverride: options.initiatorOverride,
      subagentMarker: options.subagentMarker,
      sessionId: options.sessionId,
      selectedModel,
    })
  }

  if (shouldUseResponsesApi(selectedModel)) {
    return await handleWithResponsesApi(c, {
      anthropicPayload,
      initiatorOverride: options.initiatorOverride,
      subagentOptions: {
        subagentMarker: options.subagentMarker,
        sessionId: options.sessionId,
      },
    })
  }

  return await handleWithChatCompletions(c, {
    anthropicPayload,
    initiator: options.initiatorOverride,
    subagentOptions: {
      subagentMarker: options.subagentMarker,
      sessionId: options.sessionId,
    },
  })
}

const RESPONSES_ENDPOINT = "/responses"
const MESSAGES_ENDPOINT = "/v1/messages"

export const inferAnthropicInitiatorFromLastMessage = (
  anthropicPayload: AnthropicMessagesPayload,
): "agent" | "user" => {
  const lastMessage = anthropicPayload.messages.at(-1)
  if (!lastMessage || lastMessage.role !== "user") {
    return "user"
  }

  if (!Array.isArray(lastMessage.content)) {
    return "user"
  }

  const hasToolResult = lastMessage.content.some(
    (block) => block.type === "tool_result",
  )
  if (!hasToolResult) {
    return "user"
  }

  const hasUnsupportedBlock = lastMessage.content.some(
    (block) => block.type !== "tool_result" && block.type !== "text",
  )
  return hasUnsupportedBlock ? "user" : "agent"
}

interface SubagentOptions {
  subagentMarker: SubagentMarker | null
  sessionId: string | undefined
}

const handleWithChatCompletions = async (
  c: Context,
  {
    anthropicPayload,
    initiator,
    subagentOptions,
  }: {
    anthropicPayload: AnthropicMessagesPayload
    initiator: "agent" | "user"
    subagentOptions: SubagentOptions
  },
) => {
  const openAIPayload = translateToOpenAI(anthropicPayload)
  logger.debug(
    "Translated OpenAI request payload:",
    JSON.stringify(openAIPayload),
  )

  const response = await createChatCompletions(openAIPayload, {
    initiator,
    subagentMarker: subagentOptions.subagentMarker,
    sessionId: subagentOptions.sessionId,
  })

  if (isNonStreaming(response)) {
    logger.debug(
      "Non-streaming response from Copilot:",
      JSON.stringify(response),
    )
    const anthropicResponse = translateToAnthropic(response)
    logger.debug(
      "Translated Anthropic response:",
      JSON.stringify(anthropicResponse),
    )
    return c.json(anthropicResponse)
  }

  logger.debug("Streaming response from Copilot")
  return streamSSE(c, async (stream) => {
    const streamState: AnthropicStreamState = {
      messageStartSent: false,
      contentBlockIndex: 0,
      contentBlockOpen: false,
      toolCalls: {},
      thinkingBlockOpen: false,
    }

    for await (const rawEvent of response) {
      logger.debug("Copilot raw stream event:", JSON.stringify(rawEvent))
      if (rawEvent.data === "[DONE]") {
        break
      }

      if (!rawEvent.data) {
        continue
      }

      const chunk = JSON.parse(rawEvent.data) as ChatCompletionChunk
      const events = translateChunkToAnthropicEvents(chunk, streamState)

      for (const event of events) {
        logger.debug("Translated Anthropic event:", JSON.stringify(event))
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      }
    }
  })
}

const handleWithResponsesApi = async (
  c: Context,
  {
    anthropicPayload,
    initiatorOverride,
    subagentOptions,
  }: {
    anthropicPayload: AnthropicMessagesPayload
    initiatorOverride: "agent" | "user"
    subagentOptions: SubagentOptions
  },
) => {
  const responsesPayload =
    translateAnthropicMessagesToResponsesPayload(anthropicPayload)
  logger.debug(
    "Translated Responses payload:",
    JSON.stringify(responsesPayload),
  )

  const { vision } = getResponsesRequestOptions(responsesPayload)
  const response = await createResponses(responsesPayload, {
    vision,
    initiator: initiatorOverride,
    subagentMarker: subagentOptions.subagentMarker,
    sessionId: subagentOptions.sessionId,
  })

  if (responsesPayload.stream && isAsyncIterable(response)) {
    logger.debug("Streaming response from Copilot (Responses API)")
    return streamSSE(c, async (stream) => {
      const streamState = createResponsesStreamState()

      for await (const chunk of response) {
        const eventName = chunk.event
        if (eventName === "ping") {
          await stream.writeSSE({ event: "ping", data: "" })
          continue
        }

        const data = chunk.data
        if (!data) {
          continue
        }

        logger.debug("Responses raw stream event:", data)

        const events = translateResponsesStreamEvent(
          JSON.parse(data) as ResponseStreamEvent,
          streamState,
        )
        for (const event of events) {
          const eventData = JSON.stringify(event)
          logger.debug("Translated Anthropic event:", eventData)
          await stream.writeSSE({
            event: event.type,
            data: eventData,
          })
        }

        if (streamState.messageCompleted) {
          logger.debug("Message completed, ending stream")
          break
        }
      }

      if (!streamState.messageCompleted) {
        logger.warn(
          "Responses stream ended without completion; sending error event",
        )
        const errorEvent = buildErrorEvent(
          "Responses stream ended without completion",
        )
        await stream.writeSSE({
          event: errorEvent.type,
          data: JSON.stringify(errorEvent),
        })
      }
    })
  }

  logger.debug(
    "Non-streaming Responses result:",
    JSON.stringify(response).slice(-400),
  )
  const anthropicResponse = translateResponsesResultToAnthropic(
    response as ResponsesResult,
  )
  logger.debug(
    "Translated Anthropic response:",
    JSON.stringify(anthropicResponse),
  )
  return c.json(anthropicResponse)
}

const handleWithMessagesApi = async (
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  {
    anthropicBetaHeader,
    initiatorOverride,
    subagentMarker,
    sessionId,
    selectedModel,
  }: {
    anthropicBetaHeader: string | undefined
    initiatorOverride: "agent" | "user"
    subagentMarker: SubagentMarker | null
    sessionId: string | undefined
    selectedModel: Model | undefined
  },
) => {
  // Pre-request processing: filter signed thinking blocks for Messages API
  // Signed thinking blocks may have invalid/expired signatures causing API errors
  for (const msg of anthropicPayload.messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      msg.content = msg.content.filter((block) => {
        if (block.type !== "thinking") return true
        // Only keep synthetic thinking blocks (no signature) to avoid "Invalid signature" errors
        return (
          block.thinking && block.thinking !== "Thinking..." && !block.signature
        )
      })
    }
  }

  if (selectedModel?.capabilities.supports.adaptive_thinking) {
    anthropicPayload.thinking = {
      type: "adaptive",
    }
    anthropicPayload.output_config = {
      effort: getAnthropicEffortForModel(anthropicPayload.model),
    }
  }

  logger.debug("Messages payload:", JSON.stringify(anthropicPayload))

  const response = await createMessages(anthropicPayload, {
    anthropicBetaHeader,
    initiatorOverride,
    subagentMarker,
    sessionId,
  })

  if (isAsyncIterable(response)) {
    logger.debug("Streaming response from Copilot (Messages API)")
    return streamSSE(c, async (stream) => {
      for await (const event of response) {
        const eventName = event.event
        const data = event.data ?? ""
        logger.debug("Messages raw stream event:", data)
        await stream.writeSSE({
          event: eventName,
          data,
        })
      }
    })
  }

  logger.debug(
    "Non-streaming Messages result:",
    JSON.stringify(response).slice(-400),
  )
  return c.json(response)
}

const handleWithClaudeDirect = async (
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  { anthropicBetaHeader }: { anthropicBetaHeader: string | undefined },
) => {
  const response = await forwardMessages(anthropicPayload, {
    anthropicBetaHeader,
  })

  if (isAsyncIterable(response)) {
    logger.debug("Streaming response from Claude Direct")
    return streamSSE(c, async (stream) => {
      for await (const event of response) {
        const eventName = event.event
        const data = event.data ?? ""
        logger.debug("Claude Direct raw stream event:", data)
        await stream.writeSSE({ event: eventName, data })
      }
    })
  }

  logger.debug(
    "Non-streaming Claude Direct result:",
    JSON.stringify(response).slice(-400),
  )
  return c.json(response)
}

const handleWithOllama = async (
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
) => {
  const response = await forwardMessagesToOllama(anthropicPayload)

  if (isAsyncIterable(response)) {
    logger.debug("Streaming response from Ollama")
    return streamSSE(c, async (stream) => {
      for await (const event of response) {
        const eventName = event.event
        const data = event.data ?? ""
        logger.debug("Ollama raw stream event:", data)
        await stream.writeSSE({ event: eventName, data })
      }
    })
  }

  logger.debug(
    "Non-streaming Ollama result:",
    JSON.stringify(response).slice(-400),
  )
  return c.json(response)
}

const handleWithKiro = async (
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
  { sessionId }: { sessionId: string | undefined },
) => {
  const response = await forwardMessagesToKiro(anthropicPayload, { sessionId })

  if (isAsyncIterable(response)) {
    logger.debug("Streaming response from Kiro")
    return streamSSE(c, async (stream) => {
      for await (const event of response) {
        const eventName = event.event
        const data = event.data
        logger.debug("Kiro raw stream event:", data)
        await stream.writeSSE({ event: eventName, data })
      }
    })
  }

  logger.debug(
    "Non-streaming Kiro result:",
    JSON.stringify(response).slice(-400),
  )
  return c.json(response)
}

const handleWithDeepSeek = async (
  c: Context,
  anthropicPayload: AnthropicMessagesPayload,
) => {
  const response = await forwardMessagesToDeepSeek(anthropicPayload)

  if (isAsyncIterable(response)) {
    logger.debug("Streaming response from DeepSeek")
    return streamSSE(c, async (stream) => {
      for await (const event of response) {
        const eventName = event.event
        const data = event.data ?? ""
        logger.debug("DeepSeek raw stream event:", data)
        await stream.writeSSE({ event: eventName, data })
      }
    })
  }

  logger.debug(
    "Non-streaming DeepSeek result:",
    JSON.stringify(response).slice(-400),
  )
  return c.json(response)
}

const shouldUseResponsesApi = (selectedModel: Model | undefined): boolean => {
  return (
    selectedModel?.supported_endpoints?.includes(RESPONSES_ENDPOINT) ?? false
  )
}

const shouldUseMessagesApi = (selectedModel: Model | undefined): boolean => {
  return (
    selectedModel?.supported_endpoints?.includes(MESSAGES_ENDPOINT) ?? false
  )
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse => Object.hasOwn(response, "choices")

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> =>
  Boolean(value)
  && typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function"

const getAnthropicEffortForModel = (
  model: string,
): "low" | "medium" | "high" | "max" => {
  const reasoningEffort = getReasoningEffortForModel(model)

  if (reasoningEffort === "xhigh") return "max"
  if (reasoningEffort === "none" || reasoningEffort === "minimal") return "low"
  if (model === "claude-opus-4.7" || reasoningEffort === "high") return "medium"

  return reasoningEffort
}

const isCompactRequest = (
  anthropicPayload: AnthropicMessagesPayload,
): boolean => {
  const system = anthropicPayload.system
  if (typeof system === "string") {
    return system.startsWith(compactSystemPromptStart)
  }
  if (!Array.isArray(system)) return false

  return system.some(
    (msg) =>
      typeof msg.text === "string"
      && msg.text.startsWith(compactSystemPromptStart),
  )
}

const convertWebSearchTools = (
  anthropicPayload: AnthropicMessagesPayload,
): void => {
  if (!anthropicPayload.tools) return

  anthropicPayload.tools = anthropicPayload.tools.map((tool) => {
    const toolAny = tool as unknown as Record<string, unknown>
    if (toolAny["type"] !== "web_search") return tool
    // Convert web_search tool to plain function tool so Copilot backend accepts it
    const converted = { ...toolAny }
    delete converted["type"]
    return converted as unknown as AnthropicTool
  })
}

const mergeContentWithText = (
  tr: AnthropicToolResultBlock,
  textBlock: AnthropicTextBlock,
): AnthropicToolResultBlock => {
  if (typeof tr.content === "string") {
    return { ...tr, content: `${tr.content}\n\n${textBlock.text}` }
  }
  return {
    ...tr,
    content: [...tr.content, textBlock],
  }
}

const mergeContentWithTexts = (
  tr: AnthropicToolResultBlock,
  textBlocks: Array<AnthropicTextBlock>,
): AnthropicToolResultBlock => {
  if (typeof tr.content === "string") {
    const appendedTexts = textBlocks.map((tb) => tb.text).join("\n\n")
    return { ...tr, content: `${tr.content}\n\n${appendedTexts}` }
  }
  return { ...tr, content: [...tr.content, ...textBlocks] }
}

const formatToolResultContent = (block: AnthropicToolResultBlock): string => {
  if (typeof block.content === "string") {
    return block.content
  }

  return block.content
    .map((item) =>
      item.type === "text" ? item.text : `[image:${item.source.media_type}]`,
    )
    .join("\n")
}

export const sanitizeOrphanToolResults = (
  anthropicPayload: AnthropicMessagesPayload,
): void => {
  for (const [index, msg] of anthropicPayload.messages.entries()) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue

    const previousMessage =
      index > 0 ? anthropicPayload.messages[index - 1] : undefined
    const toolUseIds = new Set<string>()

    if (
      previousMessage
      && previousMessage.role === "assistant"
      && Array.isArray(previousMessage.content)
    ) {
      for (const block of previousMessage.content) {
        if (block.type === "tool_use") {
          toolUseIds.add(block.id)
        }
      }
    }

    msg.content = msg.content.map((block) => {
      if (block.type !== "tool_result") {
        return block
      }

      if (toolUseIds.has(block.tool_use_id)) {
        return block
      }

      logger.warn(
        `Orphan tool_result converted to text at message index ${index}, tool_use_id=${block.tool_use_id}`,
      )

      const contentText = formatToolResultContent(block)
      return {
        type: "text",
        text:
          contentText
          || "[tool_result without corresponding tool_use was removed]",
      }
    })
  }
}

const mergeToolResultForClaude = (
  anthropicPayload: AnthropicMessagesPayload,
): void => {
  for (const msg of anthropicPayload.messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue

    const toolResults: Array<AnthropicToolResultBlock> = []
    const textBlocks: Array<AnthropicTextBlock> = []
    let valid = true

    for (const block of msg.content) {
      if (block.type === "tool_result") {
        toolResults.push(block)
      } else if (block.type === "text") {
        textBlocks.push(block)
      } else {
        valid = false
        break
      }
    }

    if (!valid || toolResults.length === 0 || textBlocks.length === 0) continue

    msg.content = mergeToolResult(toolResults, textBlocks)
  }
}

const mergeToolResult = (
  toolResults: Array<AnthropicToolResultBlock>,
  textBlocks: Array<AnthropicTextBlock>,
): Array<AnthropicToolResultBlock> => {
  // equal lengths -> pairwise merge
  if (toolResults.length === textBlocks.length) {
    return toolResults.map((tr, i) => mergeContentWithText(tr, textBlocks[i]))
  }

  // lengths differ -> append all textBlocks to the last tool_result
  const lastIndex = toolResults.length - 1
  return toolResults.map((tr, i) =>
    i === lastIndex ? mergeContentWithTexts(tr, textBlocks) : tr,
  )
}
