import { Image } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { mcpIconsSnapshot } from '../mcp-icons'
import { useMobileTheme } from '../theme/context'
import { ContextThumbnail } from '../ui/context-thumbnail'
import { mentionGlyphArtwork } from '../ui/mention-glyph-data'

/** The MCP server an elicitation came from; other prompts have none. */
export function elicitationServer(request: PermissionRequest): string | undefined {
  return request.requestKind === 'mcp_elicitation' ? request.serverName ?? request.toolName : undefined
}

/**
 * A prompt's header glyph. An MCP prompt shows its server's icon, else the MCP
 * mark, as the desktop card does; every other prompt keeps its kind glyph.
 */
export function PromptGlyph({ icon: Icon, server, size = 16 }: { icon: LucideIcon; server?: string; size?: number }) {
  const { tokens: { colors, scheme } } = useMobileTheme()
  const kind = <Icon size={size} color={colors.mutedForeground} />
  if (server === undefined) return kind
  const mark = mentionGlyphArtwork('mcp-resource', scheme, colors.foreground)
  const mcp = mark
    ? <Image accessible={false} resizeMode="contain" source={{ uri: `data:image/png;base64,${mark}` }} style={{ width: size, height: size, tintColor: colors.mutedForeground }} />
    : kind
  const src = mcpIconsSnapshot()[server]
  return src ? <ContextThumbnail key={src} src={src} size={size} fallback={mcp} /> : mcp
}
