import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import type {
  HarnessId, RemoteActiveProvider, RemoteHarnessOption, WorktreeInfo,
} from '@superone/shared/agent-types'
import { poweredByHint } from '../provider-state'
import type { NewSessionWorktreeSelection } from '../worktree-state'
import { useMobileTheme } from '../theme/context'
import { GitChips, HarnessIcon, HarnessTabs, ProjectSelect, ProviderBrand } from '../ui'

export type NewSessionLandingProps = {
  provider: HarnessId
  /** Ordered and labelled by the host, so the switcher reads like the desktop's. */
  harnessOptions: readonly RemoteHarnessOption[]
  activeHarnessKey: string
  onHarness: (option: RemoteHarnessOption) => void
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

/**
 * What a new session needs before it starts: which harness, which provider is
 * behind it, which project, and where in that project it runs.
 */
export function NewSessionLanding(props: NewSessionLandingProps) {
  const { tokens: { colors } } = useMobileTheme()
  const hint = poweredByHint(props.provider, props.activeProvider)
  return (
    <ScrollView keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <HarnessIcon provider={props.provider} size={88} renderLevel="rich" />
      {hint ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Powered by</Text>
          <ProviderBrand brandKey={hint.brandKey} name={hint.name} size={14} />
        </View>
      ) : null}
      <HarnessTabs options={props.harnessOptions} activeKey={props.activeHarnessKey} onChange={props.onHarness} />
      <ProjectSelect name={props.projectName} onOpen={props.onOpenProject} />
      {props.projectName ? (
        <GitChips selection={props.worktreeSelection} worktreeInfo={props.worktreeInfo}
          branch={props.branch} dirty={!!props.dirtyFiles}
          onWorktree={props.onWorktree} onBranch={props.onBranch} />
      ) : null}
    </ScrollView>
  )
}
