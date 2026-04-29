import type { KiroAuthConfig } from "~/lib/config"

export type KiroAuthType = KiroAuthConfig["auth"]

export interface KiroTokenInfo {
  accessToken: string
  expiresAt: number
  refreshToken?: string
  profileArn?: string
  machineId?: string
  region?: string
  authConfigId: string
  label: string
}

export interface KiroUsageInfo {
  available: number | null
  email?: string
  raw?: unknown
}

export interface KiroTokenWithUsage extends KiroTokenInfo {
  usage?: KiroUsageInfo
}

export interface CodeWhispererImage {
  format: "jpeg" | "png" | "gif" | "webp"
  source: {
    bytes: string
  }
}

export interface CodeWhispererTool {
  toolSpecification: {
    name: string
    description: string
    inputSchema: {
      json: Record<string, unknown>
    }
  }
}

export interface CodeWhispererToolUse {
  toolUseId: string
  name: string
  input: Record<string, unknown>
}

export interface CodeWhispererToolResult {
  toolUseId: string
  content: Array<Record<string, unknown>>
  status: "success" | "error"
  isError?: boolean
}

export interface CodeWhispererUserMessage {
  userInputMessage: {
    content: string
    modelId: string
    origin: "AI_EDITOR"
    images?: Array<CodeWhispererImage>
    userInputMessageContext?: {
      toolResults?: Array<CodeWhispererToolResult>
      tools?: Array<CodeWhispererTool>
    }
  }
}

export interface CodeWhispererAssistantMessage {
  assistantResponseMessage: {
    content: string
    toolUses?: Array<CodeWhispererToolUse>
  }
}

export type CodeWhispererHistoryMessage =
  | CodeWhispererUserMessage
  | CodeWhispererAssistantMessage

export interface CodeWhispererRequest {
  conversationState: {
    agentContinuationId: string
    agentTaskType: "vibe"
    chatTriggerType: "MANUAL" | "AUTO"
    currentMessage: CodeWhispererUserMessage
    conversationId: string
    history: Array<CodeWhispererHistoryMessage>
  }
  profileArn?: string
}

export interface KiroForwardOptions {
  sessionId?: string
}

export interface EventStreamMessage {
  headers: Record<string, string | number | boolean | Uint8Array>
  payload: Uint8Array
}

export interface ParsedCodeWhispererEvent {
  messageType: string
  eventType: string
  contentType: string
  payload: Record<string, unknown>
}

export interface KiroStreamTextEvent {
  type: "text"
  text: string
}

export interface KiroStreamToolEvent {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export type KiroStreamContentEvent = KiroStreamTextEvent | KiroStreamToolEvent
