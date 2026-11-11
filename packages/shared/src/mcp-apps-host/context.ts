import type { McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-bridge'
import type { ToolAppAttachment } from '../mcp-apps'
import { mcpAppHostStyleVariables } from './styles'

export interface McpAppHostEnvironment {
  theme: 'light' | 'dark'
  platform: 'desktop' | 'mobile' | 'web'
  locale: string
  timeZone: string
  toolInfo?: McpUiHostContext['toolInfo']
  displayMode?: 'inline' | 'fullscreen' | 'pip'
  availableDisplayModes?: Array<'inline' | 'fullscreen' | 'pip'>
  width?: number
  height?: number
  maxHeight?: number
  touch?: boolean
  hover?: boolean
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number }
  colors?: { background?: string; foreground?: string; muted?: string; mutedForeground?: string; border?: string; primary?: string; primaryForeground?: string; destructive?: string }
  fontFamily?: string
  monoFontFamily?: string
  radius?: string
}

export function mcpAppToolInfo(app?: Pick<ToolAppAttachment, 'harnessCallId' | 'toolName' | 'toolDescriptor'>): McpUiHostContext['toolInfo'] {
  const descriptor = app?.toolDescriptor
  const name = descriptor?.name ?? app?.toolName
  if (!name) return undefined
  const schema = descriptor?.inputSchema
  const inputSchema = (schema && schema.type === 'object' ? schema : { type: 'object' as const }) as NonNullable<McpUiHostContext['toolInfo']>['tool']['inputSchema']
  return {
    ...(app?.harnessCallId ? { id: app.harnessCallId } : {}),
    tool: {
      name,
      inputSchema,
      ...(descriptor?.title ? { title: descriptor.title } : {}),
      ...(descriptor?.description !== undefined ? { description: descriptor.description } : {}),
      ...(descriptor?.outputSchema ? { outputSchema: descriptor.outputSchema as NonNullable<McpUiHostContext['toolInfo']>['tool']['outputSchema'] } : {}),
      ...(descriptor?.annotations ? { annotations: descriptor.annotations as NonNullable<McpUiHostContext['toolInfo']>['tool']['annotations'] } : {}),
      ...(descriptor?._meta ? { _meta: descriptor._meta } : {}),
    },
  }
}

export function mcpAppHostContext(env: McpAppHostEnvironment): McpUiHostContext {
  const mode = env.displayMode ?? 'inline'
  const validWidth = Number.isFinite(env.width) && env.width! > 0
  const validHeight = Number.isFinite(env.height) && env.height! > 0
  const validMaxHeight = Number.isFinite(env.maxHeight) && env.maxHeight! > 0
  const dimensions: Record<string, number> = {
    ...(validWidth ? { width: env.width! } : {}),
    ...(mode === 'fullscreen'
      ? (validHeight ? { height: env.height! } : {})
      : (validMaxHeight ? { maxHeight: env.maxHeight! } : {})),
  }
  return {
    theme: env.theme,
    platform: env.platform,
    locale: env.locale,
    timeZone: env.timeZone,
    userAgent: 'SuperOne',
    ...(env.toolInfo ? { toolInfo: env.toolInfo } : {}),
    displayMode: mode,
    availableDisplayModes: env.availableDisplayModes ?? ['inline'],
    styles: { variables: mcpAppHostStyleVariables(env.theme, env) },
    containerDimensions: dimensions as McpUiHostContext['containerDimensions'],
    deviceCapabilities: { touch: env.touch ?? env.platform === 'mobile', hover: env.hover ?? env.platform === 'desktop' },
    ...(env.safeAreaInsets ? { safeAreaInsets: env.safeAreaInsets } : {}),
  }
}
