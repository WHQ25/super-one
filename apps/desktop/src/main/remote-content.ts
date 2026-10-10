import { configureRemoteContent } from '@superone/runtime/stream/delivery/remote-content'
import { readOutputFile } from './agent/claude-session-runtime'
import { listWorkflowAgentsSync } from './workflow-transcripts'
import { highlightCodeSync, highlightCodeByLang, parseAnsiTokens } from './remote-highlighter'
import { withAttachmentPreviews } from './remote/attachment-thumbnail'

/**
 * The desktop's reads behind the remote summaries (`@superone/runtime/stream/delivery`):
 * Shiki and ANSI highlighting, Electron thumbnails, subagent output files and
 * workflow transcripts. Importing this module wires them.
 */
configureRemoteContent({
  highlightCodeSync,
  highlightCodeByLang,
  parseAnsiTokens,
  withAttachmentPreviews,
  readAgentOutput: readOutputFile,
  listWorkflowAgents: listWorkflowAgentsSync,
})

export * from '@superone/runtime/stream/delivery/remote-content'
