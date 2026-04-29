import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"

import consola from "consola"

export class HTTPError extends Error {
  response: Response
  bodyText?: string

  constructor(message: string, response: Response, bodyText?: string) {
    super(message)
    this.response = response
    this.bodyText = bodyText
  }
}

export class QuotaExhaustedError extends Error {
  keyId?: string

  constructor(message: string, keyId?: string) {
    super(message)
    this.name = "QuotaExhaustedError"
    this.keyId = keyId
  }
}

export class AllProvidersExhaustedError extends Error {
  constructor(
    message: string = "All providers and keys are exhausted, please add more OpenAI keys or wait for quota reset",
  ) {
    super(message)
    this.name = "AllProvidersExhaustedError"
  }
}

export async function forwardError(c: Context, error: unknown) {
  consola.error("Error occurred:", error)

  if (error instanceof HTTPError) {
    const errorText = error.bodyText ?? (await error.response.text())
    let errorJson: unknown
    try {
      errorJson = JSON.parse(errorText)
    } catch {
      errorJson = errorText
    }
    consola.error("HTTP error:", errorJson)
    return c.json(
      {
        error: {
          message: errorText,
          type: "error",
        },
      },
      error.response.status as ContentfulStatusCode,
    )
  }

  return c.json(
    {
      error: {
        message: (error as Error).message,
        type: "error",
      },
    },
    500,
  )
}
