import { randomUUID } from "node:crypto"

import type {
  AnthropicAssistantContentBlock,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockStopEvent,
  AnthropicMessageDeltaEvent,
  AnthropicMessagesPayload,
  AnthropicMessageStartEvent,
  AnthropicMessageStopEvent,
  AnthropicPingEvent,
  AnthropicResponse,
  AnthropicStreamEventData,
} from "~/routes/messages/anthropic-types"

import type { ParsedCodeWhispererEvent } from "./types"

// ────────────────────────────────────────────────────────────────────────────
// Stream state
// ────────────────────────────────────────────────────────────────────────────

export interface KiroStreamState {
  started: boolean
  // content block index counter
  nextIndex: number
  // text block
  textBlockIndex: number
  // thinking block
  thinkingBlockIndex: number
  // whether thinking tags have been fully extracted (only one thinking block per response)
  thinkingExtracted: boolean
  // whether we are currently inside a <thinking>...</thinking> span
  inThinkingBlock: boolean
  // accumulation buffer for thinking/text content as it streams in
  pendingBuffer: string
  // per-tool state (keyed by toolUseId)
  toolBlocks: Map<string, number>
  toolJsonBuffers: Map<string, string>
  hasToolUse: boolean
  outputTokens: number
}

export function createKiroStreamState(): KiroStreamState {
  return {
    started: false,
    nextIndex: 0,
    textBlockIndex: -1,
    thinkingBlockIndex: -1,
    thinkingExtracted: false,
    inThinkingBlock: false,
    pendingBuffer: "",
    toolBlocks: new Map(),
    toolJsonBuffers: new Map(),
    hasToolUse: false,
    outputTokens: 0,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Event factory helpers
// ────────────────────────────────────────────────────────────────────────────

function mkMessageStart(
  payload: AnthropicMessagesPayload,
): AnthropicMessageStartEvent {
  return {
    type: "message_start",
    message: {
      id: `msg_${randomUUID().replaceAll("-", "")}`,
      type: "message",
      role: "assistant",
      content: [],
      model: payload.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  }
}

function mkPing(): AnthropicPingEvent {
  return { type: "ping" }
}

function mkBlockStart(
  index: number,
  contentBlock: AnthropicContentBlockStartEvent["content_block"],
): AnthropicContentBlockStartEvent {
  return { type: "content_block_start", index, content_block: contentBlock }
}

function mkBlockStop(index: number): AnthropicContentBlockStopEvent {
  return { type: "content_block_stop", index }
}

function mkTextDelta(
  index: number,
  text: string,
): AnthropicContentBlockDeltaEvent {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  }
}

function mkThinkingDelta(
  index: number,
  thinking: string,
): AnthropicContentBlockDeltaEvent {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "thinking_delta", thinking },
  }
}

function mkInputJsonDelta(
  index: number,
  partialJson: string,
): AnthropicContentBlockDeltaEvent {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json: partialJson },
  }
}

function mkMessageDelta(
  stopReason: AnthropicResponse["stop_reason"],
  outputTokens: number,
): AnthropicMessageDeltaEvent {
  return {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  }
}

function mkMessageStop(): AnthropicMessageStopEvent {
  return { type: "message_stop" }
}

// ────────────────────────────────────────────────────────────────────────────
// State mutation helpers that also collect emitted events
// ────────────────────────────────────────────────────────────────────────────

function emitTextDelta(
  text: string,
  state: KiroStreamState,
  out: Array<AnthropicStreamEventData>,
): void {
  if (!text) return

  state.outputTokens += Math.max(1, Math.ceil(text.length / 4))

  if (state.textBlockIndex === -1) {
    // Close any open thinking block first
    if (state.thinkingBlockIndex !== -1) {
      out.push(mkBlockStop(state.thinkingBlockIndex))
      state.thinkingBlockIndex = -1
    }
    state.textBlockIndex = state.nextIndex++
    out.push(mkBlockStart(state.textBlockIndex, { type: "text", text: "" }))
  }

  out.push(mkTextDelta(state.textBlockIndex, text))
}

function emitThinkingDelta(
  thinking: string,
  state: KiroStreamState,
  out: Array<AnthropicStreamEventData>,
): void {
  if (!thinking) return

  if (state.thinkingBlockIndex === -1) {
    state.thinkingBlockIndex = state.nextIndex++
    out.push(
      mkBlockStart(state.thinkingBlockIndex, {
        type: "thinking",
        thinking: "",
      }),
    )
  }

  out.push(mkThinkingDelta(state.thinkingBlockIndex, thinking))
}

// Handle the case when we're scanning for <thinking> tag
function processBufferOutsideThinking(
  state: KiroStreamState,
  out: Array<AnthropicStreamEventData>,
): boolean {
  const startPos = state.pendingBuffer.indexOf("<thinking>")
  if (startPos !== -1) {
    const before = state.pendingBuffer.slice(0, startPos)
    if (before) emitTextDelta(before, state, out)
    state.inThinkingBlock = true
    state.pendingBuffer = state.pendingBuffer.slice(
      startPos + "<thinking>".length,
    )
    return true // continue loop
  }
  const safeLen = Math.max(0, state.pendingBuffer.length - "<thinking>".length)
  if (safeLen > 0) {
    emitTextDelta(state.pendingBuffer.slice(0, safeLen), state, out)
    state.pendingBuffer = state.pendingBuffer.slice(safeLen)
  }
  return false // break
}

// Handle the case when we're inside a <thinking> block
function processBufferInsideThinking(
  state: KiroStreamState,
  out: Array<AnthropicStreamEventData>,
): boolean {
  const endPos = state.pendingBuffer.indexOf("</thinking>")
  if (endPos === -1) {
    const safeLen = Math.max(
      0,
      state.pendingBuffer.length - "</thinking>".length,
    )
    if (safeLen > 0) {
      emitThinkingDelta(state.pendingBuffer.slice(0, safeLen), state, out)
      state.pendingBuffer = state.pendingBuffer.slice(safeLen)
    }
    return false // break
  }

  const afterTag = state.pendingBuffer.slice(endPos + "</thinking>".length)
  if (afterTag.length < 2) return false // break: wait for more data

  if (afterTag.startsWith("\n\n")) {
    const thinkingContent = state.pendingBuffer.slice(0, endPos)
    if (thinkingContent) emitThinkingDelta(thinkingContent, state, out)
    state.inThinkingBlock = false
    state.thinkingExtracted = true
    if (state.thinkingBlockIndex !== -1) {
      out.push(mkBlockStop(state.thinkingBlockIndex))
      // keep thinkingBlockIndex set so we don't open another one
    }
    state.pendingBuffer = afterTag.slice(2) // skip \n\n
    return true // continue loop
  }

  // false positive </thinking>, treat as regular thinking content
  const chunk = state.pendingBuffer.slice(0, endPos + "</thinking>".length)
  emitThinkingDelta(chunk, state, out)
  state.pendingBuffer = afterTag
  return true // continue loop
}

// Process buffered content that may contain <thinking>...</thinking> tags
function processBuffer(
  incoming: string,
  state: KiroStreamState,
  out: Array<AnthropicStreamEventData>,
): void {
  state.pendingBuffer += incoming

  while (true) {
    if (!state.inThinkingBlock && !state.thinkingExtracted) {
      if (!processBufferOutsideThinking(state, out)) break
    } else if (state.inThinkingBlock) {
      if (!processBufferInsideThinking(state, out)) break
    } else {
      // thinking already extracted — rest is regular text
      if (state.pendingBuffer) {
        emitTextDelta(state.pendingBuffer, state, out)
        state.pendingBuffer = ""
      }
      break
    }
  }
}

// Flush whatever remains in the pending buffer at end-of-stream
function flushPendingBuffer(
  state: KiroStreamState,
  out: Array<AnthropicStreamEventData>,
): void {
  if (!state.pendingBuffer) return
  if (state.inThinkingBlock) {
    emitThinkingDelta(state.pendingBuffer, state, out)
    if (state.thinkingBlockIndex !== -1) {
      out.push(mkBlockStop(state.thinkingBlockIndex))
    }
  } else {
    emitTextDelta(state.pendingBuffer, state, out)
  }
  state.pendingBuffer = ""
}

// ────────────────────────────────────────────────────────────────────────────
// Payload extraction
// ────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function extractEventPayload(
  event: ParsedCodeWhispererEvent,
): Record<string, unknown> {
  const nested = event.payload.assistantResponseEvent
  return isRecord(nested) ? nested : event.payload
}

// ────────────────────────────────────────────────────────────────────────────
// Tool event handling
// ────────────────────────────────────────────────────────────────────────────

interface ToolEventContext {
  toolNameReverse: Map<string, string>
  state: KiroStreamState
  out: Array<AnthropicStreamEventData>
}

function handleToolUseEvent(
  rawPayload: Record<string, unknown>,
  ctx: ToolEventContext,
): void {
  const { toolNameReverse, state, out } = ctx
  const toolUseId =
    readString(rawPayload.toolUseId) ?? readString(rawPayload.tool_use_id) ?? ""
  const kiroName = readString(rawPayload.name) ?? ""
  const toolName = toolNameReverse.get(kiroName) ?? kiroName
  const toolInput = readString(rawPayload.input) ?? ""
  const isStop = rawPayload.stop === true

  if (!toolUseId) return

  const existing = state.toolJsonBuffers.get(toolUseId)
  state.toolJsonBuffers.set(toolUseId, (existing ?? "") + toolInput)

  if (!state.toolBlocks.has(toolUseId)) {
    flushPendingBuffer(state, out)
    if (state.textBlockIndex !== -1) {
      out.push(mkBlockStop(state.textBlockIndex))
      state.textBlockIndex = -1
    }
    const toolBlockIndex = state.nextIndex++
    state.toolBlocks.set(toolUseId, toolBlockIndex)
    state.hasToolUse = true
    out.push(
      mkBlockStart(toolBlockIndex, {
        type: "tool_use",
        id: toolUseId,
        name: toolName,
        input: {},
      }),
    )
  }

  const toolBlockIndex = state.toolBlocks.get(toolUseId)
  if (toolBlockIndex === undefined) return

  if (toolInput) out.push(mkInputJsonDelta(toolBlockIndex, toolInput))
  if (isStop) out.push(mkBlockStop(toolBlockIndex))
}

// ────────────────────────────────────────────────────────────────────────────
// Public streaming API
// ────────────────────────────────────────────────────────────────────────────

export interface KiroTranslationContext {
  payload: AnthropicMessagesPayload
  state: KiroStreamState
  toolNameReverse?: Map<string, string>
}

/**
 * Translate a single Kiro event into zero or more Anthropic SSE events.
 * toolNameReverse maps kiro-sanitised tool names back to the original names.
 */
export function translateKiroEventToAnthropic(
  event: ParsedCodeWhispererEvent,
  ctx: KiroTranslationContext,
): Array<AnthropicStreamEventData> {
  const { payload, state } = ctx
  const toolNameReverse: Map<string, string> =
    ctx.toolNameReverse ?? new Map<string, string>()
  const out: Array<AnthropicStreamEventData> = []

  if (!state.started) {
    out.push(mkMessageStart(payload), mkPing())
    state.started = true
  }

  const eventType = event.eventType
  const rawPayload = extractEventPayload(event)

  if (eventType === "assistantResponseEvent") {
    const content = readString(rawPayload.content) ?? ""
    if (content) processBuffer(content, state, out)
  } else if (eventType === "toolUseEvent") {
    handleToolUseEvent(rawPayload, { toolNameReverse, state, out })
  }
  // contextUsageEvent — ignore (no token info we can use directly)

  return out
}

/**
 * Emit final events after all Kiro events have been processed.
 */
export function finalizeKiroAnthropicStream(
  state: KiroStreamState,
): Array<AnthropicStreamEventData> {
  const out: Array<AnthropicStreamEventData> = []
  if (!state.started) return out

  // Flush pending buffer
  flushPendingBuffer(state, out)

  // Close open text block
  if (state.textBlockIndex !== -1) {
    out.push(mkBlockStop(state.textBlockIndex))
    state.textBlockIndex = -1
  }

  out.push(
    mkMessageDelta(
      state.hasToolUse ? "tool_use" : "end_turn",
      state.outputTokens,
    ),
    mkMessageStop(),
  )
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// Non-streaming (full response) translation
// ────────────────────────────────────────────────────────────────────────────

function processToolUseEvents(
  events: Array<ParsedCodeWhispererEvent>,
  toolNameReverse: Map<string, string>,
): Array<AnthropicAssistantContentBlock> {
  const toolUses: Array<AnthropicAssistantContentBlock> = []
  const toolJsonBuffers = new Map<string, string>()

  for (const event of events) {
    if (event.eventType !== "toolUseEvent") continue
    const rawPayload = extractEventPayload(event)
    const toolUseId =
      readString(rawPayload.toolUseId)
      ?? readString(rawPayload.tool_use_id)
      ?? ""
    const kiroName = readString(rawPayload.name) ?? ""
    const toolName = toolNameReverse.get(kiroName) ?? kiroName
    const toolInput = readString(rawPayload.input) ?? ""
    const isStop = rawPayload.stop === true

    if (!toolUseId) continue
    const existing = toolJsonBuffers.get(toolUseId)
    toolJsonBuffers.set(toolUseId, (existing ?? "") + toolInput)

    if (isStop) {
      const raw = toolJsonBuffers.get(toolUseId) ?? ""
      let input: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(raw) as unknown
        if (isRecord(parsed)) input = parsed
      } catch {
        // keep {}
      }
      toolUses.push({ type: "tool_use", id: toolUseId, name: toolName, input })
    }
  }

  return toolUses
}

export function translateKiroEventsToAnthropicResponse(
  payload: AnthropicMessagesPayload,
  events: Array<ParsedCodeWhispererEvent>,
  toolNameReverse: Map<string, string> = new Map(),
): AnthropicResponse {
  let textContent = ""

  for (const event of events) {
    if (event.eventType === "assistantResponseEvent") {
      const rawPayload = extractEventPayload(event)
      textContent += readString(rawPayload.content) ?? ""
    }
  }

  const toolUses = processToolUseEvents(events, toolNameReverse)

  // Extract <thinking>...</thinking> from textContent if present
  let thinkingContent = ""
  const thinkingMatch = /^<thinking>([\s\S]*?)<\/thinking>\n\n/.exec(
    textContent,
  )
  if (thinkingMatch) {
    thinkingContent = thinkingMatch[1]
    textContent = textContent.slice(thinkingMatch[0].length)
  }

  const content: Array<AnthropicAssistantContentBlock> = []
  if (thinkingContent) {
    content.push({ type: "thinking", thinking: thinkingContent, signature: "" })
  }
  if (textContent) {
    content.push({ type: "text", text: textContent })
  }
  content.push(...toolUses)

  if (content.length === 0) {
    content.push({ type: "text", text: "" })
  }

  const outputTokens = Math.ceil(
    (textContent.length + thinkingContent.length) / 4,
  )

  return {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    content,
    model: payload.model,
    stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: outputTokens },
  }
}
