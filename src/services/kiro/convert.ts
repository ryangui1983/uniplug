import { createHash, randomUUID } from "node:crypto"

import type {
  AnthropicAssistantContentBlock,
  AnthropicMessagesPayload,
  AnthropicTool,
  AnthropicUserContentBlock,
  AnthropicUserMessage,
} from "~/routes/messages/anthropic-types"

import { getConfig } from "~/lib/config"

import type {
  CodeWhispererAssistantMessage,
  CodeWhispererHistoryMessage,
  CodeWhispererImage,
  CodeWhispererRequest,
  CodeWhispererTool,
  CodeWhispererToolResult,
  CodeWhispererToolUse,
  CodeWhispererUserMessage,
  KiroForwardOptions,
} from "./types"

import { KIRO_MAX_IMAGE_BYTES } from "./constants"
import { toCodeWhispererModelId } from "./models"

// ────────────────────────────────────────────────────────────────────────────
// Tool name sanitisation + deduplication (mirrors kiro.rs converter.rs)
// ────────────────────────────────────────────────────────────────────────────

const TOOL_NAME_MAX_LEN = 63

function shortenToolName(name: string): string {
  const hash = createHash("sha256").update(name).digest("hex").slice(0, 8)
  const prefixMax = TOOL_NAME_MAX_LEN - 1 - 8 // 54 chars
  const prefix = name.slice(0, prefixMax)
  return `${prefix}_${hash}`
}

function sanitizeAndShortenToolName(name: string): string {
  const replaced = name.replaceAll(/\W/g, "_").replaceAll(/_+/g, "_")
  const trimmed = replaced.replaceAll(/^_+|_+$/g, "")
  const safe = trimmed.length > 0 ? trimmed : "tool"
  const withPrefix = /^\d/.test(safe) ? `t_${safe}` : safe
  return withPrefix.length <= TOOL_NAME_MAX_LEN ?
      withPrefix
    : shortenToolName(withPrefix)
}

function getOrCreateKiroToolName(
  originalName: string,
  toolNameMap: Map<string, string>,
  usedNames: Set<string>,
): string {
  const cached = toolNameMap.get(originalName)
  if (cached !== undefined) return cached
  const candidate = sanitizeAndShortenToolName(originalName)
  usedNames.add(candidate)
  toolNameMap.set(originalName, candidate)
  return candidate
}

// ────────────────────────────────────────────────────────────────────────────
// Schema cleaning — mirrors kiro.rs normalize_json_schema
// ────────────────────────────────────────────────────────────────────────────

function normalizeJsonSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true,
    }
  }

  const obj = { ...(schema as Record<string, unknown>) }

  // type must be a non-empty string
  if (typeof obj.type !== "string" || !obj.type) {
    obj.type = "object"
  }

  // properties must be an object
  if (
    typeof obj.properties !== "object"
    || obj.properties === null
    || Array.isArray(obj.properties)
  ) {
    obj.properties = {}
  }

  // required must be a string array
  obj.required =
    Array.isArray(obj.required) ?
      obj.required.filter((v) => typeof v === "string")
    : []

  // additionalProperties must be bool or object; default true
  if (
    typeof obj.additionalProperties !== "boolean"
    && (typeof obj.additionalProperties !== "object"
      || obj.additionalProperties === null)
  ) {
    obj.additionalProperties = true
  }

  return obj
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  let normalized: unknown = value
  if (typeof normalized === "string") {
    try {
      normalized = JSON.parse(normalized)
    } catch {
      return {}
    }
  }
  if (
    typeof normalized !== "object"
    || normalized === null
    || Array.isArray(normalized)
  ) {
    return {}
  }
  return normalized as Record<string, unknown>
}

// ────────────────────────────────────────────────────────────────────────────
// Content extraction helpers
// ────────────────────────────────────────────────────────────────────────────

function isUnsupportedTool(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === "web_search" || lower === "websearch"
}

function imageFormat(mediaType: string): CodeWhispererImage["format"] {
  if (mediaType === "image/png") return "png"
  if (mediaType === "image/gif") return "gif"
  if (mediaType === "image/webp") return "webp"
  return "jpeg"
}

function byteLengthFromBase64(data: string): number {
  let padding = 0
  if (data.endsWith("==")) padding = 2
  else if (data.endsWith("=")) padding = 1
  return Math.floor((data.length * 3) / 4) - padding
}

interface UserContentResult {
  text: string
  toolResults: Array<CodeWhispererToolResult>
  images: Array<CodeWhispererImage>
}

function getToolResultContent(
  block: Extract<AnthropicUserContentBlock, { type: "tool_result" }>,
): string {
  if (typeof block.content === "string") return block.content
  if (Array.isArray(block.content)) {
    return block.content.map((c) => ("text" in c ? c.text : "")).join("\n")
  }
  return ""
}

function extractUserContent(
  content: string | Array<AnthropicUserContentBlock>,
): UserContentResult {
  if (typeof content === "string") {
    return { text: content, toolResults: [], images: [] }
  }

  const textParts: Array<string> = []
  const toolResults: Array<CodeWhispererToolResult> = []
  const images: Array<CodeWhispererImage> = []

  for (const block of content) {
    switch (block.type) {
      case "text": {
        textParts.push(block.text)
        break
      }
      case "image": {
        if (byteLengthFromBase64(block.source.data) <= KIRO_MAX_IMAGE_BYTES) {
          images.push({
            format: imageFormat(block.source.media_type),
            source: { bytes: block.source.data },
          })
        }
        break
      }
      case "tool_result": {
        toolResults.push({
          toolUseId: block.tool_use_id,
          status: block.is_error ? "error" : "success",
          content: [{ text: getToolResultContent(block) }],
          ...(block.is_error ? { isError: true } : {}),
        })
        break
      }
      // No default
    }
  }

  return { text: textParts.join("\n"), toolResults, images }
}

interface AssistantContentResult {
  text: string
  toolUses: Array<CodeWhispererToolUse>
}

function extractAssistantContent(
  content: string | Array<AnthropicAssistantContentBlock>,
  toolNameMap: Map<string, string>,
  usedToolNames: Set<string>,
): AssistantContentResult {
  if (typeof content === "string") return { text: content, toolUses: [] }

  let thinkingContent = ""
  const textParts: Array<string> = []
  const toolUses: Array<CodeWhispererToolUse> = []

  for (const block of content) {
    switch (block.type) {
      case "thinking": {
        thinkingContent += block.thinking
        break
      }
      case "text": {
        textParts.push(block.text)
        break
      }
      case "tool_use": {
        if (isUnsupportedTool(block.name)) continue
        toolUses.push({
          toolUseId: block.id,
          name: getOrCreateKiroToolName(block.name, toolNameMap, usedToolNames),
          input: normalizeJsonObject(block.input),
        })
        break
      }
      // No default
    }
  }

  let finalText: string
  if (thinkingContent) {
    finalText =
      textParts.length > 0 ?
        `<thinking>${thinkingContent}</thinking>\n\n${textParts.join("\n")}`
      : `<thinking>${thinkingContent}</thinking>`
  } else {
    finalText = textParts.join("\n")
  }

  if (!finalText && toolUses.length > 0) {
    finalText = " "
  }

  return { text: finalText, toolUses }
}

// ────────────────────────────────────────────────────────────────────────────
// Message builders
// ────────────────────────────────────────────────────────────────────────────

function mergeUserMessages(
  messages: Array<AnthropicUserMessage>,
  modelId: string,
): CodeWhispererUserMessage["userInputMessage"] {
  const contentParts: Array<string> = []
  const allToolResults: Array<CodeWhispererToolResult> = []
  const allImages: Array<CodeWhispererImage> = []

  for (const msg of messages) {
    const { text, toolResults, images } = extractUserContent(msg.content)
    if (text) contentParts.push(text)
    allToolResults.push(...toolResults)
    allImages.push(...images)
  }

  const content =
    contentParts.join("\n") || (allToolResults.length > 0 ? "continue" : "")

  const userMsg: CodeWhispererUserMessage["userInputMessage"] = {
    content,
    modelId,
    origin: "AI_EDITOR",
  }

  if (allImages.length > 0) {
    userMsg.images = allImages
  }

  const ctx: Record<string, unknown> = {}
  if (allToolResults.length > 0) ctx.toolResults = allToolResults
  if (Object.keys(ctx).length > 0) {
    userMsg.userInputMessageContext =
      ctx as CodeWhispererUserMessage["userInputMessage"]["userInputMessageContext"]
  }

  return userMsg
}

function buildTools(
  tools: Array<AnthropicTool> | undefined,
  toolNameMap: Map<string, string>,
  usedToolNames: Set<string>,
): Array<CodeWhispererTool> {
  const maxDescriptionLength =
    getConfig().kiro.maxToolDescriptionLength ?? 10000
  return (tools ?? [])
    .filter((t) => !isUnsupportedTool(t.name))
    .map((t) => ({
      toolSpecification: {
        name: getOrCreateKiroToolName(t.name, toolNameMap, usedToolNames),
        description: (t.description ?? "").slice(0, maxDescriptionLength),
        inputSchema: { json: normalizeJsonSchema(t.input_schema) },
      },
    }))
}

interface CurrentMessageOpts {
  tools: Array<CodeWhispererTool>
  endsWithAssistant: boolean
}

function buildCurrentUserMessage(
  currentMessages: Array<AnthropicUserMessage>,
  modelId: string,
  opts: CurrentMessageOpts,
): CodeWhispererUserMessage {
  const { tools, endsWithAssistant } = opts
  let currentText: string
  const allToolResults: Array<CodeWhispererToolResult> = []
  const allImages: Array<CodeWhispererImage> = []

  if (endsWithAssistant) {
    currentText = "continue"
  } else {
    const textParts: Array<string> = []
    for (const msg of currentMessages) {
      const { text, toolResults, images } = extractUserContent(msg.content)
      if (text) textParts.push(text)
      allToolResults.push(...toolResults)
      allImages.push(...images)
    }
    currentText = textParts.join("\n") || "continue"
  }

  const ctx: Record<string, unknown> = {}
  if (tools.length > 0) ctx.tools = tools
  if (allToolResults.length > 0) ctx.toolResults = allToolResults

  const userMsg: CodeWhispererUserMessage["userInputMessage"] = {
    content: currentText,
    modelId,
    origin: "AI_EDITOR",
  }

  if (allImages.length > 0) {
    userMsg.images = allImages
  }

  if (Object.keys(ctx).length > 0) {
    userMsg.userInputMessageContext =
      ctx as CodeWhispererUserMessage["userInputMessage"]["userInputMessageContext"]
  }

  return { userInputMessage: userMsg }
}

function buildThinkingPrefix(payload: AnthropicMessagesPayload): string {
  if (payload.thinking?.type !== "enabled") return ""
  const budgetTokens = payload.thinking.budget_tokens ?? 10000
  return `<thinking_mode>enabled</thinking_mode><max_thinking_length>${budgetTokens}</max_thinking_length>`
}

function systemToText(system: AnthropicMessagesPayload["system"]): string {
  if (!system) return ""
  if (typeof system === "string") return system
  return system.map((block) => block.text).join("\n\n")
}

// ────────────────────────────────────────────────────────────────────────────
// History building helpers (extracted to keep buildCodeWhispererRequest short)
// ────────────────────────────────────────────────────────────────────────────

function buildSystemHistory(
  payload: AnthropicMessagesPayload,
  modelId: string,
): Array<CodeWhispererHistoryMessage> {
  const thinkingPrefix = buildThinkingPrefix(payload)
  const systemText = systemToText(payload.system)
  if (!systemText && !thinkingPrefix) return []

  let content: string
  if (systemText) {
    const addPrefix =
      thinkingPrefix
      && !systemText.includes("<thinking_mode>")
      && !systemText.includes("<max_thinking_length>")
    content = addPrefix ? `${thinkingPrefix}\n${systemText}` : systemText
  } else {
    content = thinkingPrefix
  }

  return [
    { userInputMessage: { content, modelId, origin: "AI_EDITOR" } },
    {
      assistantResponseMessage: {
        content: "I will follow these instructions.",
      },
    },
  ]
}

interface ConversationHistoryContext {
  messages: AnthropicMessagesPayload["messages"]
  historyEnd: number
  modelId: string
  toolNameMap: Map<string, string>
  usedToolNames: Set<string>
}

function buildConversationHistory(
  ctx: ConversationHistoryContext,
): Array<CodeWhispererHistoryMessage> {
  const { messages, historyEnd, modelId, toolNameMap, usedToolNames } = ctx
  const history: Array<CodeWhispererHistoryMessage> = []
  let userBuffer: Array<AnthropicUserMessage> = []

  for (let i = 0; i < historyEnd; i++) {
    const msg = messages[i]
    if (msg.role === "user") {
      userBuffer.push(msg)
    } else {
      if (userBuffer.length > 0) {
        history.push({
          userInputMessage: mergeUserMessages(userBuffer, modelId),
        })
        userBuffer = []
      }
      const { text, toolUses } = extractAssistantContent(
        msg.content,
        toolNameMap,
        usedToolNames,
      )
      const assistantMsg: CodeWhispererAssistantMessage["assistantResponseMessage"] =
        { content: text }
      if (toolUses.length > 0) assistantMsg.toolUses = toolUses
      history.push({ assistantResponseMessage: assistantMsg })
    }
  }

  // Orphan trailing user buffer (rare: consecutive users before assistant)
  if (userBuffer.length > 0) {
    history.push(
      { userInputMessage: mergeUserMessages(userBuffer, modelId) },
      { assistantResponseMessage: { content: "OK" } },
    )
  }

  return history
}

function addMissingToolDefs(
  history: Array<CodeWhispererHistoryMessage>,
  tools: Array<CodeWhispererTool>,
): void {
  const historyToolNames = new Set<string>()
  for (const msg of history) {
    if (
      "assistantResponseMessage" in msg
      && msg.assistantResponseMessage.toolUses
    ) {
      for (const tu of msg.assistantResponseMessage.toolUses) {
        historyToolNames.add(tu.name)
      }
    }
  }

  const existingToolNames = new Set(
    tools.map((t) => t.toolSpecification.name.toLowerCase()),
  )
  for (const toolName of historyToolNames) {
    if (!existingToolNames.has(toolName.toLowerCase())) {
      tools.push({
        toolSpecification: {
          name: toolName,
          description: "Tool used in conversation history",
          inputSchema: {
            json: {
              type: "object",
              properties: {},
              required: [],
              additionalProperties: true,
            },
          },
        },
      })
    }
  }
}

function determineChatTriggerType(
  payload: AnthropicMessagesPayload,
): "MANUAL" | "AUTO" {
  if (payload.tools && payload.tools.length > 0 && payload.tool_choice) {
    const tcType = payload.tool_choice.type
    if (tcType === "any" || tcType === "tool") return "AUTO"
  }
  return "MANUAL"
}

// ────────────────────────────────────────────────────────────────────────────
// Main conversion function
// ────────────────────────────────────────────────────────────────────────────

export interface BuildRequestResult {
  request: CodeWhispererRequest
  toolNameMap: Map<string, string>
}

export function buildCodeWhispererRequest(
  payload: AnthropicMessagesPayload,
  options: KiroForwardOptions = {},
): BuildRequestResult {
  const modelId = toCodeWhispererModelId(payload.model)
  const toolNameMap = new Map<string, string>()
  const usedToolNames = new Set<string>()
  const tools = buildTools(payload.tools, toolNameMap, usedToolNames)
  const messages = payload.messages

  let currentStart = messages.length
  while (currentStart > 0 && messages[currentStart - 1].role === "user") {
    currentStart--
  }
  const currentUserMessages = messages
    .slice(currentStart)
    .filter((m): m is AnthropicUserMessage => m.role === "user")

  const endsWithAssistant =
    currentUserMessages.length === 0
    && messages.length > 0
    && messages.at(-1)?.role === "assistant"

  const systemHistory = buildSystemHistory(payload, modelId)
  const historyEnd = endsWithAssistant ? messages.length : currentStart
  const convHistory = buildConversationHistory({
    messages,
    historyEnd,
    modelId,
    toolNameMap,
    usedToolNames,
  })
  const history = [...systemHistory, ...convHistory]
  addMissingToolDefs(history, tools)

  const currentMessage = buildCurrentUserMessage(currentUserMessages, modelId, {
    tools,
    endsWithAssistant,
  })

  const conversationId = options.sessionId ?? randomUUID()
  const agentContinuationId = randomUUID()

  return {
    request: {
      conversationState: {
        agentContinuationId,
        agentTaskType: "vibe",
        chatTriggerType: determineChatTriggerType(payload),
        currentMessage,
        conversationId,
        history,
      },
    },
    toolNameMap,
  }
}
