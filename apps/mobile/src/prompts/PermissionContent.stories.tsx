import { useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Locale, PermissionRequest } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { Text } from '../ui/text'
import { PendingPromptBar } from '../ui/pending-prompt-bar'
import { PermissionSheet } from './PermissionSheet'
import { PermissionContent } from './PermissionContent'

const external: PermissionRequest = {
  requestId: 'per_external', toolName: 'external_directory', input: {}, allowAlwaysAllow: true,
  permissionDetails: {
    action: 'external_directory', resources: ['/Users/me/Developer/reference-project/*', '/private/var/folders/04/super-one-attachments/*'], save: ['/Users/me/Developer/reference-project/*'],
    source: { toolName: 'read', toolUseId: 'call_read', messageId: 'msg_a', input: { path: '/Users/me/Developer/reference-project/docs/spec.md', offset: 1, limit: 200 } },
    metadata: { reason: 'Compare the reference implementation' },
  },
}

function Review({ request = external, width = 390, locale = 'en', light = false }: { request?: PermissionRequest; width?: number; locale?: Locale; light?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)
  return <MobileThemeProvider colorScheme={light ? 'light' : 'dark'} locale={locale}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } }}>
      <View style={{ width, height: 844, justifyContent: 'flex-end' }}>
        {outcome ? <Text>{outcome}</Text> : <>
          {collapsed ? <PendingPromptBar prompt={{ kind: 'permission', request }} onExpand={() => setCollapsed(false)} /> : null}
          <PermissionSheet perm={request} collapsed={collapsed} onCollapse={() => setCollapsed(true)} onAllow={() => setOutcome('Allowed')} onDeny={() => setOutcome('Denied')} />
        </>}
      </View>
    </SafeAreaProvider>
  </MobileThemeProvider>
}

export default { title: 'Mobile/Permission Details', component: PermissionContent }
export const ExternalDirectory = { render: () => <Review /> }
export const NarrowChineseLight = { render: () => <Review width={320} locale="zh" light /> }
export const RestoredWithoutToolArguments = { render: () => <Review request={{ ...external, permissionDetails: { action: 'external_directory', resources: ['/outside/*'], source: { toolUseId: 'call_before_reconnect' } } }} /> }
export const LegacyMessageOnly = { render: () => <Review request={{ requestId: 'legacy', toolName: 'external_directory', input: {}, message: '/outside/legacy/*', allowAlwaysAllow: false }} /> }
