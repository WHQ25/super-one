import type { HostInbound, HostOutbound } from '@superone/chat-view'
import { resolveNativeRequest, type NativeActionPorts } from './native-actions'
import { resolveRemoteFilePath } from './shell-state'

type NativeRequest = Extract<HostOutbound, { type: 'requestNative' }>
type NativeResult = Extract<HostInbound, { type: 'nativeActionResult' }>

/** What a Markdown file's links, images and diagrams may ask of the phone. */
export type MarkdownDocumentPorts = Pick<NativeActionPorts,
  'openLink' | 'previewFile' | 'loadImage' | 'loadVideoPoster' | 'previewImage' | 'previewMermaid' | 'copyText' | 'resolveFavicon'>

const DOCUMENT_ACTIONS: ReadonlySet<string> = new Set<keyof MarkdownDocumentPorts>([
  'openLink', 'previewFile', 'loadImage', 'loadVideoPoster', 'previewImage', 'previewMermaid', 'copyText', 'resolveFavicon',
])

/**
 * Answer a native request from a Markdown file preview. The file is content,
 * not a session, so only the reading actions pass; session actions (drafts,
 * approvals, MCP Apps) are refused. Media paths resolve against the file's
 * folder, as the desktop editor resolves them — the transcript's media paths
 * are project-relative instead.
 */
export async function resolveMarkdownDocumentRequest(
  message: NativeRequest,
  ports: MarkdownDocumentPorts | undefined,
  directory: string,
): Promise<NativeResult> {
  if (!ports || !DOCUMENT_ACTIONS.has(message.action)) {
    return { type: 'nativeActionResult', requestId: message.requestId, error: `${message.action} is not available in a file preview` }
  }
  const rebase = (path: string) => resolveRemoteFilePath(directory, path)
  const scoped: MarkdownDocumentPorts = {
    ...ports,
    loadImage: (path, confirmed, root) => ports.loadImage(rebase(path), confirmed, root),
    loadVideoPoster: (path, root) => ports.loadVideoPoster(rebase(path), root),
    previewImage: (target) => ports.previewImage(target.path ? { ...target, path: rebase(target.path) } : target),
  }
  // The action filter above is what keeps every other port out of reach.
  return resolveNativeRequest(message, scoped as NativeActionPorts)
}
