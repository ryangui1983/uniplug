export const KIRO_SOCIAL_REFRESH_URL =
  "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken"
export const KIRO_IDC_REFRESH_URL = "https://oidc.us-east-1.amazonaws.com/token"
export const KIRO_CODEWHISPERER_URL =
  "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
export const KIRO_USAGE_LIMITS_URL =
  "https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?isEmailRequired=true&origin=AI_EDITOR&resourceType=AGENTIC_REQUEST"

export const KIRO_TOKEN_CACHE_TTL_MS = 5 * 60 * 1000
export const KIRO_MAX_EVENT_STREAM_FRAME_BYTES = 16 * 1024 * 1024
export const KIRO_MAX_IMAGE_BYTES = 20 * 1024 * 1024

export const KIRO_VERSION = "0.8.0"
export const KIRO_SDK_VERSION = "1.0.27"

// Model ID mapping: Anthropic format → Kiro short format
export const KIRO_MODEL_MAP: Record<string, string> = {
  // Opus 4.6
  "claude-opus-4-6": "claude-opus-4.6",
  "claude-opus-4-6-thinking": "claude-opus-4.6",
  // Sonnet 4.6
  "claude-sonnet-4-6": "claude-sonnet-4.6",
  "claude-sonnet-4-6-thinking": "claude-sonnet-4.6",
  // Opus 4.5
  "claude-opus-4-5": "claude-opus-4.5",
  "claude-opus-4-5-20251101": "claude-opus-4.5",
  "claude-opus-4-5-20251101-thinking": "claude-opus-4.5",
  // Sonnet 4.5
  "claude-sonnet-4-5": "claude-sonnet-4.5",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4.5",
  "claude-sonnet-4-5-20250929-thinking": "claude-sonnet-4.5",
  "claude-sonnet-4-20250514": "claude-sonnet-4.5",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4.5",
  // Haiku 4.5
  "claude-haiku-4-5": "claude-haiku-4.5",
  "claude-haiku-4-5-20251001": "claude-haiku-4.5",
  "claude-haiku-4-5-20251001-thinking": "claude-haiku-4.5",
  "claude-3-5-haiku-20241022": "claude-haiku-4.5",
}

// Public model list (matches kiro.rs static list)
export const KIRO_PUBLIC_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-6-thinking",
  "claude-sonnet-4-6",
  "claude-sonnet-4-6-thinking",
  "claude-opus-4-5-20251101",
  "claude-opus-4-5-20251101-thinking",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-5-20250929-thinking",
  "claude-haiku-4-5-20251001",
  "claude-haiku-4-5-20251001-thinking",
] as const

// Per-model context window sizes (in tokens)
export const KIRO_MODEL_CONTEXT_TOKENS: Record<string, number> = {
  "claude-opus-4-6": 1_000_000,
  "claude-opus-4-6-thinking": 1_000_000,
  "claude-opus-4-5": 1_000_000,
  "claude-opus-4-5-20251101": 1_000_000,
  "claude-opus-4-5-20251101-thinking": 1_000_000,
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4-6-thinking": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-4-5-20250929": 200_000,
  "claude-sonnet-4-5-20250929-thinking": 200_000,
  "claude-haiku-4-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-haiku-4-5-20251001-thinking": 200_000,
}

// Default context window size (fallback)
export const KIRO_DEFAULT_CONTEXT_TOKENS = 200_000
