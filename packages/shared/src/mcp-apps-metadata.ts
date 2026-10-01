import type { McpAppIcon, McpAppPresentation, McpToolDescriptor, McpUiResourceMeta } from './mcp-apps'

export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const title = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined

/** Untrusted icons are always images, never executable markup or host-local URLs. */
export function safeMcpAppImage(src: unknown): string | undefined {
  if (typeof src !== 'string') return undefined
  if (/^data:image\/(?:svg\+xml|png|jpeg|gif|webp|avif|x-icon)(?:;[^,]*)?,/i.test(src)) return src
  try { const url = new URL(src); if (url.protocol === 'https:' && !url.username && !url.password) return url.href } catch { /* Invalid URL. */ }
  return undefined
}

export function mcpAppIcon(icons?: McpAppIcon[], theme?: 'light' | 'dark'): string | undefined {
  if (!Array.isArray(icons)) return undefined
  const candidates = theme ? [...icons.filter(icon => icon?.theme === theme), ...icons.filter(icon => !icon?.theme)] : icons
  return candidates.map(icon => safeMcpAppImage(icon?.src)).find(Boolean)
}

export function mcpAppPresentation(tool: McpToolDescriptor): McpAppPresentation {
  return { toolTitle: title(tool.title) ?? title(tool.annotations?.title) ?? tool.name,
    ...(tool.icons ? { toolIcons: tool.icons } : {}),
    ...(tool.serverInfo?.title ? { serverTitle: tool.serverInfo.title } : {}),
    ...(tool.serverInfo?.icons ? { serverIcons: tool.serverInfo.icons } : {}) }
}

/** Keep OpenAI siblings of `_meta.ui`, while exposing the stable UI fields to existing hosts. */
export function mcpAppResourceMeta(meta?: Record<string, unknown>): McpUiResourceMeta {
  const { ui, ...siblings } = meta ?? {}
  return { ...siblings, ...record(ui) }
}

/** Metadata constrains requests; it never moves an agent-invoked View out of inline. */
export function mcpAppResourceModes(meta?: McpUiResourceMeta): McpAppDisplayMode[] | undefined {
  const ui = record(meta?.['openai/ui'])
  if (Array.isArray(ui.availableDisplayModes)) return ui.availableDisplayModes.filter((mode): mode is McpAppDisplayMode => mode === 'inline' || mode === 'fullscreen')
  if (ui.preferredDisplayMode === 'inline' || ui.preferredDisplayMode === 'fullscreen') return [ui.preferredDisplayMode]
  return undefined
}

export function mcpAppPresentationIcon(presentation?: McpAppPresentation, theme?: 'light' | 'dark'): string | undefined {
  return mcpAppIcon(presentation?.toolIcons, theme) ?? mcpAppIcon(presentation?.serverIcons, theme)
}
