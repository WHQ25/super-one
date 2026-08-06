import type { CodexChatReasoningConfig } from './codex-responses/reasoning'

/** Upstream OpenAI-compatible chat completions endpoint for the protocol proxy. */
export interface ProxyUpstream {
  name: string
  /** Full chat completions URL, e.g. `https://api.example.com/v1/chat/completions`. */
  api_base_url: string
  api_key: string
  models: string[]
  /**
   * Legacy musistudio transformer names (kept for config parity with desktop).
   * The node-owned proxy ignores these and uses project transformers.
   */
  transformerUse: string[]
  reasoningConfig?: CodexChatReasoningConfig
}

export interface ProxyHandle {
  url: string
  port: number
}
