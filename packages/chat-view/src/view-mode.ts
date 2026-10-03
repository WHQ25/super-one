/**
 * Which root the one chat-view document mounts. The phone ships a single bundle
 * (`CHAT_VIEW_HTML`), so a Markdown file preview reuses the transcript's
 * renderer instead of embedding a second copy of mermaid, KaTeX and Shiki.
 * The host picks the mode before the bundle runs.
 */
export type ChatViewMode = 'chat' | 'markdown-document'

const MODE_GLOBAL = '__superoneChatViewMode'

/** A boot script for `injectedJavaScriptBeforeContentLoaded`. */
export function chatViewModeScript(mode: ChatViewMode): string {
  return `globalThis.${MODE_GLOBAL}=${JSON.stringify(mode)};`
}

export function currentChatViewMode(): ChatViewMode {
  return (globalThis as Record<string, unknown>)[MODE_GLOBAL] === 'markdown-document' ? 'markdown-document' : 'chat'
}
