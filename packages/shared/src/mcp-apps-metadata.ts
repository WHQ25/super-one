import type { McpAppIcon, McpAppPresentation, McpToolDescriptor, McpUiResourceMeta, ToolAppAttachment } from './mcp-apps'
import { safeImageUri } from './image-uri'
export { safeImageUri as safeMcpAppImage } from './image-uri'

export type McpAppDisplayMode = 'inline' | 'fullscreen' | 'pip'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const title = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.slice(0, 512) : undefined
export const MCP_APP_ICON_MAX_BYTES = 32 * 1024
export const MCP_APP_PRESENTATION_MAX_BYTES = 70 * 1024

/** Use the presentation label on every surface, retaining the binding id as fallback. */
export function mcpAppServerTitle(app: Pick<ToolAppAttachment, 'presentation' | 'binding'>): string {
  return title(app.presentation?.serverTitle) ?? app.binding.server
}

/** Server and tool may advertise the same title; show that label only once. */
export function mcpAppHeaderTitle(server: string, tool: string): string {
  return server.trim() === tool.trim() ? server : `${server} · ${tool}`
}

export function mcpAppIcon(icons?: McpAppIcon[], theme?: 'light' | 'dark'): string | undefined {
  if (!Array.isArray(icons)) return undefined
  const candidates = theme ? [...icons.filter(icon => icon?.theme === theme), ...icons.filter(icon => !icon?.theme)] : icons
  return candidates.map(icon => safeImageUri(icon?.src)).find(src => !!src && new TextEncoder().encode(src).byteLength <= MCP_APP_ICON_MAX_BYTES)
}

/** Persist only the winning safe image per theme, with a neutral image deduplicated. */
export function compactMcpAppPresentation(presentation: McpAppPresentation): McpAppPresentation {
  const resolve = (theme: 'light' | 'dark') => mcpAppIcon(presentation.icons, theme)
    ?? mcpAppIcon(presentation.toolIcons, theme) ?? mcpAppIcon(presentation.serverIcons, theme)
  const light = resolve('light'), dark = resolve('dark')
  const icons: McpAppIcon[] = light && light === dark ? [{ src: light }]
    : [...(light ? [{ src: light, theme: 'light' as const }] : []), ...(dark ? [{ src: dark, theme: 'dark' as const }] : [])]
  return { toolTitle: title(presentation.toolTitle) ?? 'App',
    ...(title(presentation.serverTitle) ? { serverTitle: title(presentation.serverTitle) } : {}),
    ...(icons.length ? { icons } : {}) }
}

export function mcpAppPresentation(tool: McpToolDescriptor): McpAppPresentation {
  return compactMcpAppPresentation({ toolTitle: title(tool.title) ?? title(tool.annotations?.title) ?? tool.name,
    toolIcons: tool.icons, serverTitle: tool.serverInfo?.title, serverIcons: tool.serverInfo?.icons })
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
  return mcpAppIcon(presentation?.icons, theme) ?? mcpAppIcon(presentation?.toolIcons, theme) ?? mcpAppIcon(presentation?.serverIcons, theme)
}
