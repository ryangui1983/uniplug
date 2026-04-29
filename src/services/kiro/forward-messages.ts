import { randomBytes } from "node:crypto"

import type {
  AnthropicMessagesPayload,
  AnthropicResponse,
} from "~/routes/messages/anthropic-types"

import { HTTPError } from "~/lib/error"

import type { KiroForwardOptions, KiroTokenInfo } from "./types"

import { KIRO_SDK_VERSION, KIRO_VERSION } from "./constants"
import { buildCodeWhispererRequest } from "./convert"
import {
  AwsEventStreamParser,
  parseCodeWhispererEvent,
  parseCompleteEventStream,
} from "./event-stream"
import {
  createKiroStreamState,
  finalizeKiroAnthropicStream,
  translateKiroEventsToAnthropicResponse,
  translateKiroEventToAnthropic,
} from "./stream-translation"
import { kiroTokenManager } from "./token-manager"

export interface KiroStreamEvent {
  event: string
  data: string
}

export type KiroForwardMessagesReturn =
  | AnthropicResponse
  | AsyncGenerator<KiroStreamEvent>

function buildUserAgents(token: KiroTokenInfo): {
  amzUserAgent: string
  userAgent: string
} {
  const machineId = token.machineId ?? randomBytes(32).toString("hex")
  const amzUserAgent = `aws-sdk-js/${KIRO_SDK_VERSION} KiroIDE-${KIRO_VERSION}-${machineId}`
  const userAgent = `aws-sdk-js/${KIRO_SDK_VERSION} ua/2.1 os/windows lang/js md/nodejs#20.0.0 api/codewhispererstreaming#${KIRO_SDK_VERSION} m/E KiroIDE-${KIRO_VERSION}-${machineId}`
  return { amzUserAgent, userAgent }
}

function kiroHeaders(token: KiroTokenInfo): Record<string, string> {
  const { amzUserAgent, userAgent } = buildUserAgents(token)
  const region = token.region ?? "us-east-1"
  return {
    "content-type": "application/json",
    "x-amzn-codewhisperer-optout": "true",
    "x-amzn-kiro-agent-mode": "vibe",
    "x-amz-user-agent": amzUserAgent,
    "user-agent": userAgent,
    host: `q.${region}.amazonaws.com`,
    "amz-sdk-invocation-id": crypto.randomUUID(),
    "amz-sdk-request": "attempt=1; max=3",
    authorization: `Bearer ${token.accessToken}`,
    connection: "close",
  }
}

async function throwKiroHttpError(response: Response): Promise<never> {
  const bodyText = await response.text()
  if (response.status === 403) {
    throw new HTTPError(
      "Kiro token is invalid",
      new Response(bodyText || "Token已失效，请重试", { status: 401 }),
      bodyText || "Token已失效，请重试",
    )
  }
  throw new HTTPError("Kiro request failed", response, bodyText)
}

async function* streamKiroResponse(
  response: Response,
  payload: AnthropicMessagesPayload,
  toolNameReverse: Map<string, string>,
): AsyncGenerator<KiroStreamEvent> {
  const body = response.body
  if (!body) {
    throw new Error("Kiro streaming response has no body")
  }

  const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const parser = new AwsEventStreamParser()
  const streamState = createKiroStreamState()

  while (true) {
    const readResult = await reader.read()
    if (readResult.done) break
    if (readResult.value.length === 0) continue

    for (const message of parser.push(readResult.value)) {
      const parsed = parseCodeWhispererEvent(message)
      const events = translateKiroEventToAnthropic(parsed, {
        payload,
        state: streamState,
        toolNameReverse,
      })
      for (const event of events) {
        yield { event: event.type, data: JSON.stringify(event) }
      }
    }
  }

  for (const event of finalizeKiroAnthropicStream(streamState)) {
    yield { event: event.type, data: JSON.stringify(event) }
  }
}

export async function forwardMessagesToKiro(
  payload: AnthropicMessagesPayload,
  options: KiroForwardOptions = {},
): Promise<KiroForwardMessagesReturn> {
  const token = await kiroTokenManager.getToken()
  const { request: body, toolNameMap } = buildCodeWhispererRequest(
    payload,
    options,
  )

  // Build reverse mapping: kiro-sanitised name → original name
  const toolNameReverse = new Map<string, string>()
  for (const [originalName, kiroName] of toolNameMap) {
    toolNameReverse.set(kiroName, originalName)
  }

  if (token.profileArn) {
    body.profileArn = token.profileArn
  }

  const region = token.region ?? "us-east-1"
  const url = `https://q.${region}.amazonaws.com/generateAssistantResponse`
  const response = await fetch(url, {
    method: "POST",
    headers: kiroHeaders(token),
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwKiroHttpError(response)
  }

  if (payload.stream) {
    return streamKiroResponse(response, payload, toolNameReverse)
  }

  const buffer = new Uint8Array(await response.arrayBuffer())
  const events = parseCompleteEventStream(buffer)
  return translateKiroEventsToAnthropicResponse(
    payload,
    events,
    toolNameReverse,
  )
}
