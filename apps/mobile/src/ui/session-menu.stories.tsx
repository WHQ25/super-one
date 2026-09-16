import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { SessionMenuBody } from './session-menu'

function Frame({ forkable }: { forkable: boolean }) {
  return (
    <MobileThemeProvider>
      <View style={{ width: 280, padding: 8, backgroundColor: '#1c1c1e', borderRadius: 12 }}>
        <SessionMenuBody
          onOpenTerminal={() => {}}
          onOpenFiles={() => {}}
          onFork={forkable ? () => {} : undefined}
        />
      </View>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/SessionMenu',
  component: SessionMenuBody,
}

export const Forkable = {
  name: 'Forkable · terminal, files, both fork targets',
  render: () => <Frame forkable />,
}

export const NotForkable = {
  name: 'Not forkable · worktree session or harness without fork',
  render: () => <Frame forkable={false} />,
}
