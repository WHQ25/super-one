import { View } from 'react-native'
import { Text } from '../ui/text'
import { FOLD_CONTENT_INSET, FOLD_PORTRAIT_STATUS_TRAILING } from '../layout-state'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import type { MobileColorScheme } from '../theme/tokens'
import { MobileHeader } from './mobile-header'

const noop = () => {}

/** The portrait Duo status cluster, measured from the glass's right edge. */
const STATUS_CLUSTER_WIDTH = 134

function Band({ title, colorScheme = 'dark' }: { title: string; colorScheme?: MobileColorScheme }) {
  return (
    <MobileThemeProvider colorScheme={colorScheme} locale="en">
      <BandFrame title={title} />
    </MobileThemeProvider>
  )
}

function BandFrame({ title }: { title: string }) {
  const { tokens } = useMobileTheme()
  return (
    <View style={{ width: 669, height: 180, backgroundColor: tokens.colors.background, paddingTop: FOLD_CONTENT_INSET }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 28, right: 0, width: STATUS_CLUSTER_WIDTH, height: 44,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 16 }}>
        <Text style={{ color: tokens.colors.foreground, fontSize: 15, fontVariant: ['tabular-nums'] }}>03:17</Text>
      </View>
      <View style={{ paddingRight: FOLD_PORTRAIT_STATUS_TRAILING }}>
        <MobileHeader
          route="chat"
          title={title}
          provider="claude"
          deviceStatus="connectedLan"
          onBack={noop}
          onSwitchSession={noop}
          onOpenTerminal={noop}
          onOpenFiles={noop}
        />
      </View>
    </View>
  )
}

export default {
  title: 'Mobile/MobileHeader/Duo portrait',
  component: MobileHeader,
}

export const NewSession = {
  name: 'Portrait fold · header shares the status band',
  render: () => <Band title="New Session" />,
}

export const LongTitle = {
  name: 'Portrait fold · long title stops before the clock',
  render: () => <Band title="Investigate the foldable status inset on the inner panel" />,
}

export const Light = {
  name: 'Portrait fold · light',
  render: () => <Band title="New Session" colorScheme="light" />,
}
