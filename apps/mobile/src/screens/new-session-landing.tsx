import { Folder, GitBranch } from 'lucide-react-native'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness-capabilities'
import { MOBILE_HARNESS_IDS } from '../provider-state'
import { useMobileTheme } from '../theme/context'
import { HarnessIcon, SelectionField } from '../ui'

export type NewSessionLandingProps = {
  provider: HarnessId; projectName?: string; branch?: string
  onProvider: (provider: HarnessId) => void; onProject: () => void; onWorktree: () => void
}

export function NewSessionLanding(props: NewSessionLandingProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
    <HarnessIcon provider={props.provider} size={56} renderLevel="rich" />
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Text style={{ fontSize: 23, fontWeight: '500', color: colors.foreground }}>What shall we build?</Text>
      <Text style={{ fontSize: 13, color: colors.mutedForeground }}>Powered by {HARNESS_CAPABILITIES[props.provider].displayName}</Text>
    </View>
    <SelectionField compact label="Agent" value={props.provider}
      options={MOBILE_HARNESS_IDS.map((id) => ({ value: id, label: HARNESS_CAPABILITIES[id].displayName }))}
      onChange={(value) => props.onProvider(value as HarnessId)} />
    <View style={{ width: '100%', maxWidth: 300, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose project" onPress={props.onProject} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14 }}>
        <Folder size={17} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ fontSize: 14, color: colors.foreground, flex: 1 }}>{props.projectName || 'Choose a project'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose worktree" onPress={props.onWorktree} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: colors.border }}>
        <GitBranch size={15} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedForeground, flex: 1 }}>{props.branch || 'Local workspace'}</Text>
      </Pressable>
    </View>
  </ScrollView>
}
