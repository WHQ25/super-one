import { useEffect, useState } from 'react'
import { View } from 'react-native'
import {
  mcpMentionCardStatus, mcpMentionPreviewState, parseMcpMentionValue, type McpMentionCardState, type McpMentionReadResource,
} from '@superone/shared/mcp-app-mentions'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { monospace } from '../prompts/styles'
import { AnchoredMenu } from './anchored-menu'
import { MentionIdentity } from './composer-suggestions'
import { ContextAttachmentPreview } from './context-attachments'
import type { AnchorRect } from './popover-layout'
import { Text } from './text'

/** The desktop card's lines (`chat.mentionPopup.mcpPreview*`); a composer chip only ever previews. */
const LINES = {
  loading: 'Reading the resource…',
  failed: "Couldn't read it now; SuperOne tries again when you send.",
  content: 'Will be sent to the agent with the message ({{count}} characters, read again at send):',
  truncated: 'Will be sent to the agent with the message: the first {{count}} characters, read again at send:',
  linkOnly: "This resource can't be inlined; only the link will be sent.",
} as const

/** What sending will inline for a composer MCP chip: the URI, a status line and the text. */
export function McpMentionPreview({ value, state }: { value: string; state: McpMentionCardState }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const target = parseMcpMentionValue(value)
  if (!target) return null
  const { line, count } = mcpMentionCardStatus(state)
  const text = state.status === 'read' ? state.resource?.text : undefined
  return <View style={{ gap: 6 }}>
    <View style={{ paddingHorizontal: 4, gap: 4 }}>
      <Text selectable numberOfLines={1} style={{ fontFamily: monospace, fontSize: 11, color: colors.mutedForeground }}>{target.uri}</Text>
      <Text accessibilityLiveRegion="polite" style={{ fontSize: 12, color: colors.mutedForeground }}>{t(LINES[line]).replace('{{count}}', String(count))}</Text>
    </View>
    {text !== undefined ? <ContextAttachmentPreview item={{ id: value, title: target.uri, content: text }} /> : null}
  </View>
}

/**
 * The floating card a composer MCP chip opens on tap, like a context chip's: read on
 * open, so the user sees what sending will inline. `read` is absent before a session.
 */
export function McpMentionPreviewMenu({ press, read, onDismiss }: {
  press: { value: string; anchor: AnchorRect } | null
  read: (value: string) => Promise<McpMentionReadResource | null>
  onDismiss: () => void
}) {
  const [state, setState] = useState<McpMentionCardState>({ status: 'loading' })
  const value = press?.value
  useEffect(() => {
    if (!value) return
    let live = true
    setState({ status: 'loading' })
    read(value).then((resource) => { if (live) setState(mcpMentionPreviewState(resource)) }, () => { if (live) setState({ status: 'failed' }) })
    return () => { live = false }
  }, [value, read])
  const target = value ? parseMcpMentionValue(value) : null
  return <AnchoredMenu anchor={press && target ? press.anchor : null} title={target?.server ?? ''} onDismiss={onDismiss} width={640} titleProminent
    titleIcon={value ? <MentionIdentity item={{ kind: 'mcp-resource', path: value }} size={14} /> : undefined}>
    {value ? <McpMentionPreview value={value} state={state} /> : null}
  </AnchoredMenu>
}
