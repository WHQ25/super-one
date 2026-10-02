import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { encodeMcpMentionValue, type McpMentionCardState, type McpMentionReadResource } from '@superone/shared/mcp-app-mentions'
import type { Locale } from '@superone/shared/agent-types'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { McpMentionPreview, McpMentionPreviewMenu } from './mcp-mention-preview'
import { useMenuAnchor } from './anchored-menu'
import { Text } from './text'

const VALUE = encodeMcpMentionValue('bits', 'cad://parts/hex-bolt')
const TEXT = 'M6 × 30 hex bolt\nGrade 8.8, stainless steel, ISO 4017\nThread pitch 1.0 mm, head 10 mm across flats'
const read = (resource: Partial<McpMentionReadResource>): McpMentionCardState =>
  ({ status: 'read', resource: { server: 'bits', uri: 'cad://parts/hex-bolt', ...resource } })

function Card({ state, width = 360, dark = false, locale = 'en' }: { state: McpMentionCardState; width?: number; dark?: boolean; locale?: Locale }) {
  return <MobileThemeProvider colorScheme={dark ? 'dark' : 'light'} locale={locale}>
    <Surface width={width}><McpMentionPreview value={VALUE} state={state} /></Surface>
  </MobileThemeProvider>
}

function Surface({ width, children }: { width: number; children: ReactNode }) {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ width, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>{children}</View>
}

/** Tap the chip: the card floats above it and reads the resource, as in the composer. */
function Tappable({ answer }: { answer: McpMentionReadResource | null }) {
  const menu = useMenuAnchor()
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ width: 390, height: 520, justifyContent: 'flex-end', padding: 12 }}>
    <Pressable ref={menu.ref} accessibilityRole="button" onPress={menu.open}
      style={{ alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.muted }}>
      <Text style={{ color: colors.foreground, fontSize: 13 }}>Hex bolt</Text>
    </Pressable>
    <McpMentionPreviewMenu press={menu.anchor ? { value: VALUE, anchor: menu.anchor } : null}
      read={() => new Promise((resolve) => setTimeout(() => resolve(answer), 600))}
      onDismiss={menu.close} />
  </View>
}

export default { title: 'Mobile/McpMentionPreview', component: McpMentionPreview }

export const Loading = { render: () => <Card state={{ status: 'loading' }} /> }
export const Content = { render: () => <Card state={read({ text: TEXT })} /> }
export const ContentDark = { render: () => <Card dark state={read({ text: TEXT })} /> }
export const Truncated = { render: () => <Card state={read({ text: TEXT, truncated: true })} /> }
export const LinkOnly = { render: () => <Card state={read({ skipped: 'binary' })} /> }
export const Failed = { render: () => <Card state={{ status: 'failed' }} /> }
export const ChineseNarrow = { render: () => <Card width={280} locale="zh" state={read({ text: '六角螺栓 M6 × 30\n'.repeat(30) })} /> }
export const TapChip = { render: () => <MobileThemeProvider><Tappable answer={{ server: 'bits', uri: 'cad://parts/hex-bolt', text: TEXT }} /></MobileThemeProvider> }
export const TapChipFails = { render: () => <MobileThemeProvider><Tappable answer={null} /></MobileThemeProvider> }
