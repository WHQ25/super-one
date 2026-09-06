import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { Text } from '../ui/text'
import type {
  HarnessId,
  ModelOption,
  RemoteEffortOption,
  WorktreeInfo,
} from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness-capabilities'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import type { NewSessionWorktreeSelection } from '../worktree-state'
import { harnessSupportsAdditionalDirs, MOBILE_HARNESS_IDS } from '../provider-state'
import { Button, SelectionField } from '../ui'
import { ModelPicker } from '../ui/model-picker'
import { WorktreePicker } from '../ui/worktree-picker'

export type ShellGitInfo = {
  branch: string | null
  ahead?: number
  behind?: number
  dirty?: { files: number; insertions: number; deletions: number }
}

export type ModelRow = ModelOption

export type ProjectSettingsProps = {
  activeSession?: boolean
  section?: 'worktree'

  gitInfo: ShellGitInfo | null
  worktreeInfo: WorktreeInfo | null
  worktreeDirty?: Record<string, number>
  branches: string[]
  checkedOutBranches: string[]
  worktreeSelection: NewSessionWorktreeSelection
  onWorktreeSelectionChange: (selection: NewSessionWorktreeSelection) => void
  selectedProvider: HarnessId
  selectedModel: string
  selectedEffort: string
  models: ModelRow[]
  efforts: RemoteEffortOption[]
  workspaceDirs: string[]
  additionalDir: string
  onAdditionalDirChange: (value: string) => void
  onProviderChange: (provider: HarnessId) => void
  onModelChange: (model: string) => void
  onEffortChange: (effort: string) => void
  onOpenFiles: () => void
  onAddDirectory: () => void
  onRemoveDirectory: (dir: string) => void
}

export function SettingsScreen(props: ProjectSettingsProps) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const content = <>
      {!props.section ? <View style={styles.settingsCard}>
        <Text style={styles.sectionTitle}>Repository</Text>
        <Text style={styles.rowTitle}>{props.gitInfo?.branch ?? 'Not a Git repository'}</Text>
        {props.gitInfo?.dirty ? (
          <Text style={styles.rowMeta}>
            {props.gitInfo.dirty.files} changed · +{props.gitInfo.dirty.insertions} −{props.gitInfo.dirty.deletions}
          </Text>
        ) : <Text style={styles.rowMeta}>Working tree clean</Text>}
        <Text style={styles.rowMeta}>
          {props.worktreeInfo?.isWorktree
            ? `Worktree · ${props.worktreeInfo.currentBranch ?? ''}`
            : 'Main worktree'}
        </Text>
        <Button label="Browse project files" variant="secondary" onPress={props.onOpenFiles} />
      </View> : null}

      {!props.section ? <View style={styles.settingsCard}>
        <Text style={styles.sectionTitle}>{props.activeSession ? 'Current session' : 'Session defaults'}</Text>
        <Text style={styles.rowMeta}>{props.activeSession ? 'Model and effort apply to your next message.' : 'Choose how your next session starts.'}</Text>
        {props.activeSession ? <Text style={styles.rowTitle}>{HARNESS_CAPABILITIES[props.selectedProvider].displayName}</Text> : <SelectionField label="Agent" value={props.selectedProvider}
          options={MOBILE_HARNESS_IDS.map((provider) => ({ value: provider, label: HARNESS_CAPABILITIES[provider].displayName }))}
          onChange={(value) => props.onProviderChange(value as HarnessId)} />}
        <ModelPicker harness={props.selectedProvider} model={props.selectedModel} models={props.models}
          effort={props.selectedEffort} efforts={props.efforts} onModel={props.onModelChange} onEffort={props.onEffortChange} />
      </View> : null}

      <View style={props.section ? { gap: 12 } : styles.settingsCard}>
        <Text style={styles.sectionTitle}>New session worktree</Text>
        <Text style={styles.rowMeta}>Applies to the next Claude session.</Text>
        {props.selectedProvider !== 'claude' ? (
          <Text style={styles.rowMeta}>Remote worktree creation is currently available for Claude sessions.</Text>
        ) : (
          <WorktreePicker
            selection={props.worktreeSelection}
            onSelectionChange={props.onWorktreeSelectionChange}
            gitInfo={props.gitInfo}
            worktreeInfo={props.worktreeInfo}
            worktreeDirty={props.worktreeDirty}
            branches={props.branches}
            checkedOutBranches={props.checkedOutBranches}
          />
        )}
      </View>

      {!props.section && harnessSupportsAdditionalDirs(props.selectedProvider) ? (
        <View style={styles.settingsCard}>
          <Text style={styles.sectionTitle}>Additional directories</Text>
          {props.workspaceDirs.map((dir) => (
            <View key={dir} style={styles.rowBetween}>
              <Text numberOfLines={1} style={styles.directoryText}>{dir}</Text>
              <Pressable onPress={() => props.onRemoveDirectory(dir)}>
                <Text style={styles.back}>Remove</Text>
              </Pressable>
            </View>
          ))}
          <TextInput
            style={styles.input}
            placeholder="Absolute directory path"
            placeholderTextColor={tokens.colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            value={props.additionalDir}
            onChangeText={props.onAdditionalDirChange}
          />
          <Button label="Add directory" variant="secondary" disabled={!props.additionalDir.trim()} onPress={props.onAddDirectory} />
        </View>
      ) : null}
    </>
  return props.section ? <View>{content}</View> : <ScrollView keyboardShouldPersistTaps="handled" style={styles.flex} contentContainerStyle={styles.settingsContent}>{content}</ScrollView>
}
