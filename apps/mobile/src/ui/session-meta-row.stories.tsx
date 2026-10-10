import { View } from 'react-native'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { Text } from './text'
import { SessionMetaRow } from './session-meta-row'

const branch = 'refactor/unified-session-state-and-remote-control-architecture'

function Cases({ colorScheme }: { colorScheme: string }) {
  const { tokens: { colors } } = useMobileTheme()
  return <View style={{ backgroundColor: colors.background, padding: 12, gap: 12 }}>
    {[220, 280].map(width => <View key={width} style={{ width, gap: 8 }}>
      <Text>{`${colorScheme} · ${width} pt header title column`}</Text>
      <SessionMetaRow deviceStatus="connectedLan" subtitle="super-one"
        git={{ kind: 'branch', branch, dirtyFiles: 2 }} onOpenBranch={() => {}} />
      <SessionMetaRow deviceStatus="connectedCloud" subtitle="super-one"
        git={{ kind: 'worktreeBranch', branch }} />
    </View>)}
  </View>
}

function Preview() {
  return <View style={{ gap: 12 }}>
    {(['dark', 'light'] as const).map(colorScheme => <MobileThemeProvider key={colorScheme} colorScheme={colorScheme}>
      <Cases colorScheme={colorScheme} />
    </MobileThemeProvider>)}
    <MobileThemeProvider colorScheme="dark" locale="zh">
      <View style={{ width: 220, padding: 12 }}>
        <SessionMetaRow deviceStatus="connectedLan" subtitle="super-one"
          git={{ kind: 'worktreeBranch', branch }} />
      </View>
    </MobileThemeProvider>
  </View>
}

export default { title: 'Mobile/SessionMetaRow', component: SessionMetaRow }
export const ProjectBeforeLongBranch = { render: Preview }
