import { readAgentOutputFile } from '@superone/runtime/stream/delivery/agent-output'
import { withAttachmentPreviews } from '@superone/runtime/stream/delivery/attachment-preview'
import { highlightCodeByLang, highlightCodeSync, initHighlighter, parseAnsiTokens } from '@superone/runtime/stream/delivery/highlight'
import { installDefaultRemoteContent } from '@superone/runtime/stream/delivery/remote-content'
import { listWorkflowAgentsSync } from '@superone/runtime/stream/delivery/workflow-agents'
import { encodeNodeThumbnail } from './thumbnail-encoder'

/**
 * Phone and relay clients read this process the way they read a desktop.
 * Syntax, ANSI, picture thumbnails, subagent transcripts and workflow agent
 * rows are the same host ports. A process that already installed its own
 * port is left alone, so an in-process desktop test keeps Shiki and Electron.
 */
export function installNodeRemoteContent(): boolean {
  initHighlighter()
  return installDefaultRemoteContent({
    highlightCodeSync,
    highlightCodeByLang,
    parseAnsiTokens,
    withAttachmentPreviews: (message) => withAttachmentPreviews(message, encodeNodeThumbnail),
    readAgentOutput: readAgentOutputFile,
    listWorkflowAgents: listWorkflowAgentsSync,
  })
}

/** @deprecated Use {@link installNodeRemoteContent}. Kept for callers that named the transcript reader only. */
export function installNodeAgentOutput(): boolean {
  return installNodeRemoteContent()
}
