import { useState } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import type { MobileColorScheme } from '../theme/tokens'
import type { Locale } from '@superone/shared/agent-types'
import { MobileHeader, type McpAppHeaderProps } from './mobile-header'

const noop = () => {}

function Bar({ mcpApp, width }: { mcpApp: Partial<McpAppHeaderProps>; width: number }) {
  const { tokens } = useMobileTheme()
  const [composerOpen, setComposerOpen] = useState(mcpApp.composerOpen ?? false)
  return (
    <View style={{ width, backgroundColor: tokens.colors.background }}>
      <MobileHeader
        route="chat"
        title="Plan the weekend"
        subtitle="super-one"
        provider="claude"
        hasSession
        sessionId="s1"
        deviceStatus="connectedLan"
        onBack={noop}
        onSwitchSession={noop}
        onOpenTerminal={noop}
        onOpenFiles={noop}
        mcpApp={{ title: 'Maps', streaming: false, unread: false, onExit: noop, ...mcpApp,
          composerOpen, onToggleComposer: () => setComposerOpen((open) => !open) }}
      />
    </View>
  )
}

function Frame({ mcpApp = {}, width = 390, colorScheme = 'dark', locale = 'en' }: {
  mcpApp?: Partial<McpAppHeaderProps>
  width?: number
  colorScheme?: MobileColorScheme
  locale?: Locale
}) {
  return (
    <MobileThemeProvider colorScheme={colorScheme} locale={locale}>
      <Bar mcpApp={mcpApp} width={width} />
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/MobileHeader/MCP App fullscreen',
  component: MobileHeader,
}

export const ComposerAway = {
  name: 'Composer away · tap the toggle to bring it back',
  render: () => <Frame />,
}

export const ComposerOpen = {
  name: 'Composer open · toggle on',
  render: () => <Frame mcpApp={{ composerOpen: true }} />,
}

export const Running = {
  name: 'Running · a turn is in flight with the transcript hidden',
  render: () => <Frame mcpApp={{ streaming: true }} />,
}

export const NewReply = {
  name: 'New reply · the turn ended while the composer was away',
  render: () => <Frame mcpApp={{ unread: true }} />,
}

export const LongTitleNarrow = {
  name: 'Long title · 320 pt, truncates between the two actions',
  render: () => <Frame width={320} mcpApp={{ title: 'Interactive Floor Plan Designer for Office Buildings' }} />,
}

export const LightChinese = {
  name: 'Light · Chinese labels',
  render: () => <Frame colorScheme="light" locale="zh" mcpApp={{ unread: true }} />,
}
