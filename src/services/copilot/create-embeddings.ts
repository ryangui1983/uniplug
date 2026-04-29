import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"
import { fetchCopilotWithRetry } from "~/services/copilot/request"

export const createEmbeddings = async (payload: EmbeddingRequest) => {
  const response = await fetchCopilotWithRetry({
    url: `${copilotBaseUrl(state)}/embeddings`,
    init: {
      method: "POST",
      body: JSON.stringify(payload),
    },
    buildHeaders: () => copilotHeaders(state),
  })

  if (!response.ok) throw new HTTPError("Failed to create embeddings", response)

  return (await response.json()) as EmbeddingResponse
}

export interface EmbeddingRequest {
  input: string | Array<string>
  model: string
}

export interface Embedding {
  object: string
  embedding: Array<number>
  index: number
}

export interface EmbeddingResponse {
  object: string
  data: Array<Embedding>
  model: string
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}
