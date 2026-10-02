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

const PAINT = /(?:^|[\s;"'{])(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*([^"';\s>)]+\)?)/gi
const NEUTRAL_NAMES = new Set(['black', 'white', 'gray', 'grey', 'silver', 'dimgray', 'dimgrey', 'darkgray', 'darkgrey', 'lightgray', 'lightgrey', 'gainsboro', 'whitesmoke'])

/** Black, white or a grey: a colour that only works on one theme. A brand hue reads on both. */
function isNeutralColour(colour: string): boolean {
  if (NEUTRAL_NAMES.has(colour)) return true
  let channels: number[] | undefined
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(colour)?.[1]
  if (hex) channels = (hex.length <= 4 ? [...hex.slice(0, 3)].map(c => c + c) : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)]).map(c => parseInt(c, 16))
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(colour)
  if (rgb) channels = rgb.slice(1, 4).map(Number)
  return !!channels && Math.max(...channels) - Math.min(...channels) <= 24
}

/**
 * The SVG inside a data URI icon when it is drawn in one neutral colour (or
 * the default black), else undefined. Such icons are tinted with the text
 * colour: the spec asks for monochrome `currentColor` icons, which an `<img>`
 * can never resolve, and servers that hard-code a dark stroke would vanish on
 * a dark theme. Brand-coloured and multi-colour logos, raster images and
 * remote URLs are drawn as they are.
 */
export function mcpAppMonochromeSvg(src: string): string | undefined {
  const match = /^data:image\/svg\+xml(;[^,]*)?,(.*)$/is.exec(src)
  if (!match) return undefined
  let svg: string
  try {
    svg = /;base64/i.test(match[1] ?? '') ? atob(match[2]) : decodeURIComponent(match[2])
  } catch {
    return undefined
  }
  if (/<(?:image|foreignObject)\b/i.test(svg)) return undefined
  const colours = new Set<string>()
  for (const [, value] of svg.matchAll(PAINT)) {
    const colour = value.toLowerCase()
    if (colour !== 'none' && colour !== 'transparent' && colour !== 'currentcolor' && colour !== 'inherit' && !colour.startsWith('url(')) colours.add(colour)
  }
  return colours.size === 0 || (colours.size === 1 && [...colours].every(isNeutralColour)) ? svg : undefined
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
