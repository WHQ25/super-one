import type { McpUiHostCapabilities } from '@modelcontextprotocol/ext-apps/app-bridge'

/** Both shells share the implemented content contract. Phone new-session routing is refused. */
export const mcpAppMessageCapabilities = {
  experimental: { 'openai/message': {}, 'openai/modelContext': {} },
  message: { text: {}, image: {}, resourceLink: {}, resource: {} },
  updateModelContext: { text: {}, image: {}, resourceLink: {}, resource: {}, structuredContent: {} },
} satisfies McpUiHostCapabilities

/**
 * A View opened through a file entrypoint lives outside the transcript, so it has no
 * session to message or attach context to; it reads and writes its file instead.
 */
export const mcpAppFileCapabilities = {
  experimental: { 'openai/resource': {} },
} satisfies McpUiHostCapabilities
