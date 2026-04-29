import type { ModelsResponse } from "~/services/copilot/get-models"

import {
  KIRO_MODEL_CONTEXT_TOKENS,
  KIRO_MODEL_MAP,
  KIRO_PUBLIC_MODELS,
} from "./constants"

export function toCodeWhispererModelId(model: string): string {
  if (KIRO_MODEL_MAP[model]) return KIRO_MODEL_MAP[model]
  // Fallback: unknown models map to appropriate tier
  const lower = model.toLowerCase()
  if (lower.includes("opus")) return "claude-opus-4.5"
  if (lower.includes("haiku")) return "claude-haiku-4.5"
  return "claude-sonnet-4.5"
}

export function getContextTokensForModel(model: string): number {
  return KIRO_MODEL_CONTEXT_TOKENS[model] ?? 200_000
}

export function getKiroModels(): ModelsResponse {
  return {
    object: "list",
    data: KIRO_PUBLIC_MODELS.map((id) => ({
      id,
      name: id,
      object: "model",
      vendor: "kiro",
      version: id,
      preview: false,
      model_picker_enabled: true,
      capabilities: {
        family: "claude",
        object: "model_capabilities",
        type: "chat",
        tokenizer: "claude",
        limits: {
          max_prompt_tokens: getContextTokensForModel(id),
          max_output_tokens: 8192,
        },
        supports: {
          streaming: true,
          tool_calls: true,
          parallel_tool_calls: false,
          structured_outputs: false,
          vision: true,
        },
      },
      supported_endpoints: ["/v1/messages"],
    })),
  }
}
