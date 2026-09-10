import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { SessionRowContent } from './session-row-content'

const idle = {
  session: { sessionId: 'one', title: 'Review the composer loading state', isPinned: true, provider: 'codex' as const },
  child: false, hasChildren: false, collapsed: false,
}

function Preview() {
  return <MobileThemeProvider>
    <View style={{ width: 300, padding: 12, gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>Pinned section</Text>
        <SessionRowContent branded item={idle} subtitle="super-one" />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 12, opacity: 0.6 }}>Project list · same session</Text>
        <SessionRowContent item={idle} />
      </View>
    </View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/SessionRow',
  component: SessionRowContent,
  render: Preview,
}

export const PinnedSectionVsProjectList = {}
