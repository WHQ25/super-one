import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import type { HarnessId, RemoteActiveProvider, WorktreeInfo } from '@superone/shared/agent-types'
import { poweredByHint } from '../provider-state'
import type { NewSessionWorktreeSelection } from '../worktree-state'
import { useMobileTheme } from '../theme/context'
import { GitChips, HarnessIcon, HarnessTabs, ProjectSelect, ProviderBrand } from '../ui'

export type NewSessionLandingProps = {
  provider: HarnessId
  harnesses: readonly HarnessId[]
  onProvider: (provider: HarnessId) => void
  activeProvider?: RemoteActiveProvider | null
  projectName?: string
  onOpenProject: () => void
  worktreeSelection: NewSessionWorktreeSelection
  worktreeInfo?: WorktreeInfo | null
  branch?: string | null
  dirtyFiles?: number
  onWorktree: () => void
  onBranch: () => void
}

export function NewSessionLanding(props: NewSessionLandingProps) {
  const { tokens: { colors } } = useMobileTheme()
  const hint = poweredByHint(props.provider, props.activeProvider)
  return (
    <ScrollView keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <HarnessIcon provider={props.provider} size={88} renderLevel="rich" />
      {hint ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Powered by</Text>
          <ProviderBrand brandKey={hint.brandKey} name={hint.name} size={18} />
        </View>
      ) : null}
      <HarnessTabs harnesses={props.harnesses} value={props.provider} onChange={props.onProvider} />
      <ProjectSelect name={props.projectName} onOpen={props.onOpenProject} />
      {props.projectName ? (
        <GitChips selection={props.worktreeSelection} worktreeInfo={props.worktreeInfo}
          branch={props.branch} dirty={!!props.dirtyFiles}
          onWorktree={props.onWorktree} onBranch={props.onBranch} />
      ) : null}
    </ScrollView>
  )
}
