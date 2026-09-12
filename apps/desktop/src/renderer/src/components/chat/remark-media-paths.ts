import { remarkImageDestinations } from '@superone/chat-view/presenters/markdown-media'
import { resolveMarkdownMediaSrc } from './chat-shared'

/** Resolve parsed destinations onto `local-file:` / `remote-media:` for this project. */
export function remarkMediaPaths(projectPath: string) {
  return remarkImageDestinations((src) => resolveMarkdownMediaSrc(src, projectPath))
}
