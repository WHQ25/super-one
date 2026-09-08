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
  const activeHarness = props.harnessOptions.find((option) => option.key === props.activeHarnessKey)
  return (
    <ScrollView keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 72, gap: 8 }}>
      <View style={{ alignItems: 'center', gap: 0 }}>
        <HarnessIcon provider={props.provider} acpAgentId={activeHarness?.acpAgentId} size={80} renderLevel="rich" />
        {/* Keep the same footprint for harnesses without a provider hint. */}
        <View style={{ height: 18, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          {hint ? <>
            <Text style={{ fontSize: 11, color: colors.mutedForeground }}>Powered by</Text>
            <ProviderBrand brandKey={hint.brandKey} name={hint.name} size={14} />
          </> : null}
        </View>
        <HarnessTabs options={props.harnessOptions} activeKey={props.activeHarnessKey} onChange={props.onHarness} />
      </View>
      <ProjectSelect name={props.projectName} onOpen={props.onOpenProject} />
      {props.projectName ? (
        <GitChips selection={props.worktreeSelection} worktreeInfo={props.worktreeInfo}
          branch={props.branch} dirty={!!props.dirtyFiles}
          onWorktree={props.onWorktree} onBranch={props.onBranch} />
      ) : null}
    </ScrollView>
  )
}
