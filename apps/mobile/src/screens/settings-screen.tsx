import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { HarnessId, WorktreeInfo, WorktreeMode } from '@superone/shared/agent-types'
import { useMobileStyles, useMobileTheme } from '../theme/context'
import {
  LOCAL_WORKTREE_SELECTION,
  worktreeSelectionError,
  type NewSessionWorktreeSelection,
} from '../worktree-state'

export type ShellGitInfo = {
  branch: string | null
  dirty?: { files: number; insertions: number; deletions: number }
}

export type ModelRow = { id?: string; name?: string }

type Props = {
  gitInfo: ShellGitInfo | null
  worktreeInfo: WorktreeInfo | null
  branches: string[]
  checkedOutBranches: string[]
  worktreeSelection: NewSessionWorktreeSelection
  onWorktreeSelectionChange: (selection: NewSessionWorktreeSelection) => void
  selectedProvider: HarnessId
  selectedModel: string
  models: ModelRow[]
  workspaceDirs: string[]
  additionalDir: string
  onAdditionalDirChange: (value: string) => void
  onProviderChange: (provider: HarnessId) => void
  onModelChange: (model: string) => void
  onOpenFiles: () => void
  onAddDirectory: () => void
  onRemoveDirectory: (dir: string) => void
}

function selectionIs(
  selection: NewSessionWorktreeSelection,
  kind: 'local' | 'existing',
  path?: string,
): boolean {
  if (kind === 'local') return selection.kind === 'local'
  return selection.kind === 'existing' && selection.path === path
}

export function SettingsScreen(props: Props) {
  const styles = useMobileStyles()
  const { tokens } = useMobileTheme()
  const selection = props.worktreeSelection
  const error = worktreeSelectionError(selection, props.branches, props.checkedOutBranches)
  const existing = (props.worktreeInfo?.entries ?? []).filter((entry) => !entry.isMain)

  const chooseBase = (baseBranch: string) => {
    props.onWorktreeSelectionChange({
      kind: 'create',
      baseBranch,
      mode: 'branch',
      branchName: '',
      carryLocalChanges: false,
    })
  }
  const patchCreate = (patch: Partial<Extract<NewSessionWorktreeSelection, { kind: 'create' }>>) => {
    if (selection.kind === 'create') props.onWorktreeSelectionChange({ ...selection, ...patch })
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
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
        <Pressable style={styles.secondaryBtn} onPress={props.onOpenFiles}>
          <Text style={styles.btnText}>Browse project files</Text>
        </Pressable>
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.sectionTitle}>New session provider</Text>
        <View style={styles.chips}>
          {(['claude', 'codex'] as HarnessId[]).map((provider) => (
            <Pressable
              key={provider}
              style={[styles.chip, props.selectedProvider === provider ? styles.chipOn : null]}
              onPress={() => props.onProviderChange(provider)}
            >
              <Text style={styles.rowTitle}>{provider}</Text>
            </Pressable>
          ))}
        </View>
        {props.models.length ? (
          <ScrollView horizontal contentContainerStyle={styles.modelStrip}>
            {props.models.map((model) => {
              const id = model.id ?? model.name ?? ''
              if (!id) return null
              return (
                <Pressable
                  key={id}
                  style={[styles.chip, props.selectedModel === id ? styles.chipOn : null]}
                  onPress={() => props.onModelChange(id)}
                >
                  <Text style={styles.rowMeta}>{model.name ?? id}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : <Text style={styles.rowMeta}>Default model</Text>}
      </View>

      <View style={styles.settingsCard}>
        <Text style={styles.sectionTitle}>New session worktree</Text>
        <Text style={styles.rowMeta}>Applies to the next Claude session.</Text>
        {props.selectedProvider !== 'claude' ? (
          <Text style={styles.rowMeta}>Remote worktree creation is currently available for Claude sessions.</Text>
        ) : (
          <>
            <Pressable
              style={[styles.row, selectionIs(selection, 'local') ? styles.selectedRow : null]}
              onPress={() => props.onWorktreeSelectionChange(LOCAL_WORKTREE_SELECTION)}
            >
              <Text style={styles.rowTitle}>Local · {props.gitInfo?.branch ?? 'current branch'}</Text>
            </Pressable>
            {existing.map((entry) => (
              <Pressable
                key={entry.path}
                style={[styles.row, selectionIs(selection, 'existing', entry.path) ? styles.selectedRow : null]}
                onPress={() => props.onWorktreeSelectionChange({
                  kind: 'existing',
                  path: entry.path,
                  ...(entry.branch ? { branch: entry.branch } : {}),
                })}
              >
                <Text style={styles.rowTitle}>Existing · {entry.branch || 'detached'}</Text>
                <Text numberOfLines={1} style={styles.rowMeta}>{entry.path}</Text>
              </Pressable>
            ))}
            {props.branches.length ? (
              <>
                <Text style={styles.rowMeta}>Create from branch</Text>
                <ScrollView horizontal contentContainerStyle={styles.modelStrip}>
                  {props.branches.map((branch) => (
                    <Pressable
                      key={branch}
                      style={[styles.chip, selection.kind === 'create' && selection.baseBranch === branch ? styles.chipOn : null]}
                      onPress={() => chooseBase(branch)}
                    >
                      <Text style={styles.rowMeta}>{branch}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
            {selection.kind === 'create' ? (
              <View style={styles.subCard}>
                <View style={styles.chips}>
                  {(['branch', 'attach', 'detach'] as WorktreeMode[]).map((mode) => (
                    <Pressable
                      key={mode}
                      style={[styles.chip, selection.mode === mode ? styles.chipOn : null]}
                      onPress={() => patchCreate({ mode })}
                    >
                      <Text style={styles.rowMeta}>{mode}</Text>
                    </Pressable>
                  ))}
                </View>
                {selection.mode === 'branch' ? (
                  <TextInput
                    style={styles.input}
                    value={selection.branchName}
                    onChangeText={(branchName) => patchCreate({ branchName })}
                    placeholder="New branch name, e.g. feat/mobile"
                    placeholderTextColor={tokens.colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                ) : null}
                {props.gitInfo?.dirty ? (
                  <Pressable
                    style={[styles.chip, selection.carryLocalChanges ? styles.chipOn : null]}
                    onPress={() => patchCreate({ carryLocalChanges: !selection.carryLocalChanges })}
                  >
                    <Text style={styles.rowMeta}>Carry {props.gitInfo.dirty.files} local changes</Text>
                  </Pressable>
                ) : null}
                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </View>
            ) : null}
          </>
        )}
      </View>

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
        <Pressable style={styles.btn} onPress={props.onAddDirectory}>
          <Text style={styles.btnText}>Add directory</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}
