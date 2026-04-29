import type { EventStreamMessage, ParsedCodeWhispererEvent } from "./types"

import { KIRO_MAX_EVENT_STREAM_FRAME_BYTES } from "./constants"

const PRELUDE_BYTES = 12
const MESSAGE_CRC_BYTES = 4
const decoder = new TextDecoder()

function readUInt32(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(
    0,
    false,
  )
}

function readInt16(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 2).getInt16(
    0,
    false,
  )
}

function readInt32(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getInt32(
    0,
    false,
  )
}

function readFloat64(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset + offset, 8).getFloat64(
    0,
    false,
  )
}

function concatBytes(
  left: Uint8Array,
  right: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(left.length + right.length)
  result.set(left, 0)
  result.set(right, left.length)
  return result
}

function parseHeaders(
  bytes: Uint8Array,
): Record<string, string | number | boolean | Uint8Array> {
  const headers: Record<string, string | number | boolean | Uint8Array> = {}
  let offset = 0

  while (offset < bytes.length) {
    const nameLength = bytes[offset]
    offset += 1
    const name = decoder.decode(bytes.slice(offset, offset + nameLength))
    offset += nameLength
    const type = bytes[offset]
    offset += 1

    switch (type) {
      case 0: {
        headers[name] = true

        break
      }
      case 1: {
        headers[name] = false

        break
      }
      case 2: {
        headers[name] = bytes[offset]
        offset += 1

        break
      }
      case 3: {
        headers[name] = readInt16(bytes, offset)
        offset += 2

        break
      }
      case 4: {
        headers[name] = readInt32(bytes, offset)
        offset += 4

        break
      }
      case 5:
      case 8: {
        headers[name] = readFloat64(bytes, offset)
        offset += 8

        break
      }
      case 6:
      case 7: {
        const valueLength = readInt16(bytes, offset)
        offset += 2
        const valueBytes = bytes.slice(offset, offset + valueLength)
        headers[name] = type === 7 ? decoder.decode(valueBytes) : valueBytes
        offset += valueLength

        break
      }
      case 9: {
        headers[name] = bytes.slice(offset, offset + 16)
        offset += 16

        break
      }
      default: {
        throw new Error(`Unsupported AWS EventStream header type: ${type}`)
      }
    }
  }

  return headers
}

export class AwsEventStreamParser {
  private buffer: Uint8Array<ArrayBuffer> = new Uint8Array(0)

  push(chunk: Uint8Array): Array<EventStreamMessage> {
    this.buffer = concatBytes(this.buffer, chunk)
    const messages: Array<EventStreamMessage> = []

    while (this.buffer.length >= PRELUDE_BYTES) {
      const totalLength = readUInt32(this.buffer, 0)
      const headersLength = readUInt32(this.buffer, 4)

      if (totalLength < PRELUDE_BYTES + MESSAGE_CRC_BYTES) {
        throw new Error("Invalid AWS EventStream frame length")
      }
      if (totalLength > KIRO_MAX_EVENT_STREAM_FRAME_BYTES) {
        throw new Error("AWS EventStream frame exceeds max size")
      }
      if (this.buffer.length < totalLength) {
        break
      }

      const frame = this.buffer.slice(0, totalLength)
      const headerStart = PRELUDE_BYTES
      const payloadStart = headerStart + headersLength
      const payloadEnd = totalLength - MESSAGE_CRC_BYTES
      if (payloadStart > payloadEnd) {
        throw new Error("Invalid AWS EventStream header length")
      }

      messages.push({
        headers: parseHeaders(frame.slice(headerStart, payloadStart)),
        payload: frame.slice(payloadStart, payloadEnd),
      })
      this.buffer = this.buffer.slice(totalLength)
    }

    return messages
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseCodeWhispererEvent(
  message: EventStreamMessage,
): ParsedCodeWhispererEvent {
  const raw = decoder.decode(message.payload)
  const parsed = raw.trim() ? (JSON.parse(raw) as unknown) : {}
  const payload = isRecord(parsed) ? parsed : { content: raw }
  const messageType = message.headers[":message-type"]
  const eventType = message.headers[":event-type"]
  const contentType = message.headers[":content-type"]

  return {
    messageType: typeof messageType === "string" ? messageType : "event",
    eventType:
      typeof eventType === "string" ? eventType : "assistantResponseEvent",
    contentType:
      typeof contentType === "string" ? contentType : "application/json",
    payload,
  }
}

export function parseCompleteEventStream(
  data: Uint8Array,
): Array<ParsedCodeWhispererEvent> {
  const parser = new AwsEventStreamParser()
  return parser.push(data).map((message) => parseCodeWhispererEvent(message))
}
