import { useState, type ReactNode } from 'react'
import { Check, GitBranch, GitCommitHorizontal, Laptop, Search } from 'lucide-react-native'
import { Pressable, TextInput, View } from 'react-native'
import { Text } from './text'
import type { WorktreeEntry, WorktreeInfo, WorktreeMode } from '@superone/shared/agent-types'
import type { ShellGitInfo } from '../screens/settings-screen'
import { useMobileTheme } from '../theme/context'
import {
  attachUnavailableReason,
  filterWorktreeEntries,
  worktreeBranchHeading,
} from '../worktree-picker-state'
import {
  LOCAL_WORKTREE_SELECTION,
  worktreeSelectionError,
  type NewSessionWorktreeSelection,
} from '../worktree-state'

const MODES: Array<{ value: WorktreeMode; label: string }> = [
  { value: 'branch', label: 'New branch' },
  { value: 'attach', label: 'Attach' },
  { value: 'detach', label: 'Detach' },
]

/**
 * Where the next session runs, laid out like the desktop `WorkDirIndicator`
 * popover: search, the main checkout, existing worktrees, then the branch list
 * whose heading names what picking one will do. Choosing a base branch reveals
 * the pending panel — mode, branch name, and whether to carry local changes.
 */
export function WorktreePicker(props: {
  selection: NewSessionWorktreeSelection
  onSelectionChange: (selection: NewSessionWorktreeSelection) => void
  gitInfo: ShellGitInfo | null
  worktreeInfo: WorktreeInfo | null
  /** Uncommitted file count per worktree path, when the desktop has reported it. */
  worktreeDirty?: Record<string, number>
  branches: string[]
  checkedOutBranches: string[]
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [query, setQuery] = useState('')
  const selection = props.selection
  const existing = filterWorktreeEntries(props.worktreeInfo, query)
  const search = query.trim().toLowerCase()
  const branches = search ? props.branches.filter((branch) => branch.toLowerCase().includes(search)) : props.branches
  const pending = selection.kind === 'create' ? selection : null
  const error = worktreeSelectionError(selection, props.branches, props.checkedOutBranches)
  const blocked = (branch: string) => attachUnavailableReason(branch, props.worktreeInfo, props.checkedOutBranches)
  const patch = (values: Partial<Extract<NewSessionWorktreeSelection, { kind: 'create' }>>) => {
    if (pending) props.onSelectionChange({ ...pending, ...values })
  }
  const heading = (label: string) => (
    <Text style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2, fontSize: 11,
      textTransform: 'uppercase', letterSpacing: 0.6, color: colors.mutedForeground }}>{label}</Text>
  )
  const separator = <View style={{ height: 1, marginTop: 4, backgroundColor: colors.border }} />
  const row = (key: string, label: string, onPress: (() => void) | null, mark: ReactNode, body: ReactNode, trailing?: ReactNode) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={onPress ?? undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm,
        backgroundColor: pressed && onPress ? colors.muted : 'transparent' })}>
      {mark}
      <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
      {trailing}
    </Pressable>
  )
  const mutedMark = <GitBranch size={16} color={colors.mutedForeground} />
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Search size={15} color={colors.mutedForeground} />
        <TextInput value={query} onChangeText={setQuery} accessibilityLabel="Search worktrees and branches"
          placeholder="Search worktrees and branches…" placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none" autoCorrect={false}
          style={{ flex: 1, minHeight: 44, fontSize: 14, color: colors.foreground }} />
      </View>
      <View>
        {row('local', 'Local', selection.kind === 'local' ? null : () => props.onSelectionChange(LOCAL_WORKTREE_SELECTION),
          <Laptop size={16} color={colors.mutedForeground} />,
          <Text numberOfLines={1} style={{ fontSize: 14, color: colors.foreground }}>Local</Text>,
          selection.kind === 'local' ? <Check size={16} color={colors.primary} /> : undefined)}

        {existing.length ? <>
          {separator}
          {heading('Existing worktrees')}
          {existing.map((entry) => (
            <ExistingRow key={entry.path} entry={entry} dirtyFiles={props.worktreeDirty?.[entry.path]}
              selected={selection.kind === 'existing' && selection.path === entry.path}
              onPress={() => props.onSelectionChange({
                kind: 'existing', path: entry.path, ...(entry.branch ? { branch: entry.branch } : {}),
              })} />
          ))}
        </> : null}

        {branches.length ? <>
          {separator}
          {heading(worktreeBranchHeading(pending?.mode ?? null))}
          {branches.map((branch) => {
            const reason = pending?.mode === 'attach' ? blocked(branch) : null
            return row(branch, branch, reason ? null : () => props.onSelectionChange({
              kind: 'create', baseBranch: branch, mode: pending?.mode ?? 'branch',
              branchName: pending?.branchName ?? '', carryLocalChanges: pending?.carryLocalChanges ?? false,
            }), mutedMark, <>
              <Text numberOfLines={1} style={{ fontSize: 14, color: reason ? colors.mutedForeground : colors.foreground }}>{branch}</Text>
              {reason ? <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedForeground }}>{reason}</Text> : null}
            </>, pending?.baseBranch === branch ? <Check size={16} color={colors.primary} /> : undefined)
          })}
        </> : null}

        {!existing.length && !branches.length && search ? (
          <Text style={{ padding: 12, fontSize: 13, textAlign: 'center', color: colors.mutedForeground }}>No matches</Text>
        ) : null}
      </View>

      {pending ? (
        <View style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
            Base branch: <Text style={{ color: colors.foreground }}>{pending.baseBranch}</Text>
          </Text>
          <View style={{ flexDirection: 'row', gap: 2, padding: 2, borderRadius: radius.md, backgroundColor: colors.muted }}>
            {MODES.filter((mode) => mode.value !== 'attach' || !blocked(pending.baseBranch)).map((mode) => (
              <Pressable key={mode.value} accessibilityRole="tab" accessibilityState={{ selected: pending.mode === mode.value }}
                accessibilityLabel={mode.label} onPress={() => patch({ mode: mode.value })}
                style={{ flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm,
                  backgroundColor: pending.mode === mode.value ? colors.background : 'transparent' }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: pending.mode === mode.value ? colors.foreground : colors.mutedForeground }}>
                  {mode.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {pending.mode === 'branch' ? (
            <>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>New branch name</Text>
              <TextInput value={pending.branchName} onChangeText={(branchName) => patch({ branchName })}
                accessibilityLabel="New branch name" placeholder="e.g. fix/login-bug"
                placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoCorrect={false}
                style={{ minHeight: 44, paddingHorizontal: 10, fontSize: 14, color: colors.foreground,
                  borderWidth: 1, borderRadius: radius.md, borderColor: error ? colors.destructive : colors.border }} />
            </>
          ) : (
            <Text style={{ padding: 10, fontSize: 12, lineHeight: 18, borderRadius: radius.md,
              backgroundColor: colors.muted, color: colors.mutedForeground }}>
              {pending.mode === 'attach'
                ? `Worktree will check out ${pending.baseBranch}. Continue work on this existing branch in an isolated directory.`
                : `Worktree will detach at ${pending.baseBranch}. No branch is created.`}
            </Text>
          )}
          {error ? <Text accessibilityRole="alert" style={{ fontSize: 12, color: colors.destructive }}>{error}</Text> : null}
          {props.gitInfo?.dirty?.files ? (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: pending.carryLocalChanges }}
              accessibilityLabel="Carry local changes"
              onPress={() => patch({ carryLocalChanges: !pending.carryLocalChanges })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
              <View style={{ width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 4,
                borderWidth: 1, borderColor: pending.carryLocalChanges ? colors.foreground : colors.mutedForeground,
                backgroundColor: pending.carryLocalChanges ? colors.foreground : 'transparent' }}>
                {pending.carryLocalChanges ? <Check size={12} color={colors.background} /> : null}
              </View>
              <Text style={{ flex: 1, fontSize: 13, color: colors.foreground }}>Carry local changes</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
                {props.gitInfo.dirty.files} files
                <Text style={{ color: colors.success }}> +{props.gitInfo.dirty.insertions}</Text>
                <Text style={{ color: colors.error }}> -{props.gitInfo.dirty.deletions}</Text>
              </Text>
            </Pressable>
          ) : null}
          <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Worktree will be created on next message</Text>
        </View>
      ) : null}
    </View>
  )
}

function ExistingRow(props: {
  entry: WorktreeEntry
  dirtyFiles?: number
  selected: boolean
  onPress: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const detached = !props.entry.branch
  const files = props.dirtyFiles ?? 0
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: props.selected }}
      accessibilityLabel={detached ? `Detached ${props.entry.head.slice(0, 7)}` : props.entry.branch}
      onPress={props.onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48,
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm,
        backgroundColor: pressed ? colors.muted : 'transparent' })}>
      {detached
        ? <GitCommitHorizontal size={16} color={colors.mutedForeground} />
        : <GitBranch size={16} color={colors.mutedForeground} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14, color: detached ? colors.mutedForeground : colors.foreground }}>
          {detached ? 'Detached' : props.entry.branch}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedForeground }}>{props.entry.head.slice(0, 7)}</Text>
      </View>
      {props.dirtyFiles === undefined ? null : (
        <Text style={{ fontSize: 12, color: files > 0 ? colors.warning : colors.mutedForeground }}>
          {files > 0 ? `${files} ${files === 1 ? 'file' : 'files'}` : 'clean'}
        </Text>
      )}
      {props.selected ? <Check size={16} color={colors.primary} /> : null}
    </Pressable>
  )
}
