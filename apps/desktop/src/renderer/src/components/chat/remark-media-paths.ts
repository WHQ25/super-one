import { remarkImageDestinations } from '@superone/chat-view/presenters/markdown-media'
import { resolveMarkdownMediaSrc } from './chat-shared'

function remarkProjectMediaPaths({ projectPath }: { projectPath: string }) {
  return remarkImageDestinations((src) => resolveMarkdownMediaSrc(src, projectPath))()
}

/** Resolve parsed destinations onto the containing project's media transport. */
export function remarkMediaPaths(projectPath: string): [typeof remarkProjectMediaPaths, { projectPath: string }] {
  // Streamdown keys processors by plugin name + serialized options, not closure
  // identity. Carry the root as an option or the first project's resolver leaks
  // into every later pane, including local/remote session switches.
  return [remarkProjectMediaPaths, { projectPath }]
}
