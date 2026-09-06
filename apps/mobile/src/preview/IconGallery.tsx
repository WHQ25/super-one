import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId } from '@superone/shared/agent-types'
import { HarnessIcon } from '../ui/harness-icon'
import { FileTypeIcon } from '../ui/file-icon'
import { useMobileTheme } from '../theme/context'

const brands: { label: string; provider: HarnessId; acpAgentId?: string }[] = [
  { label: 'Claude', provider: 'claude' }, { label: 'Codex', provider: 'codex' },
  { label: 'Cursor', provider: 'cursor' }, { label: 'OpenCode', provider: 'opencode' },
  { label: 'DeepSeek', provider: 'dsh' }, { label: 'Grok', provider: 'acp', acpAgentId: 'grok' },
  { label: 'ACP', provider: 'acp' },
]
const states = ['default', 'running', 'background', 'unseen', 'automation'] as const
const filenames = ['index.ts', 'App.tsx', 'index.test.ts', 'main.dart', 'package.json', 'Dockerfile', 'README.md',
  '.gitignore', 'bun.lock', 'photo.png', 'logo.svg', 'report.pdf', 'unknown.filetype']

export function IconGallery() {
  const { tokens: { colors } } = useMobileTheme()
  return <ScrollView contentContainerStyle={{ padding: 12, gap: 16 }}>
    <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '500', color: colors.foreground }}>Desktop icon parity</Text>
    <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Idle · Running · Background · Unread · Automation</Text>
    {brands.map((brand) => <View key={brand.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ width: 64, fontSize: 12, color: colors.foreground }}>{brand.label}</Text>
      {states.map((status) => <View key={status} accessibilityLabel={`${brand.label}: ${status}`} style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <HarnessIcon {...brand} status={status} size={26} />
      </View>)}
    </View>)}
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', padding: 16 }}>
      <HarnessIcon provider="claude" size={64} renderLevel="rich" />
      <HarnessIcon provider="codex" size={64} renderLevel="rich" />
    </View>
    <Text accessibilityRole="header" style={{ fontSize: 15, color: colors.foreground }}>File and folder identities</Text>
    {[...filenames.map((name) => ({ name, directory: false })), ...['src', 'node_modules', '.git', 'unknown-folder'].map((name) => ({ name, directory: true }))].map((item) =>
      <View key={item.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 }}>
        <FileTypeIcon {...item} size={22} />
        <Text style={{ fontSize: 13, color: colors.foreground }}>{item.name}</Text>
      </View>)}
  </ScrollView>
}
