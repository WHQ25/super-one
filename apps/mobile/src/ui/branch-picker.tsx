import { useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native'
import { Text } from './text'
import { Check, GitBranch, Plus, Search } from 'lucide-react-native'
import { branchToCreate, filterBranches } from '../branch-picker-state'
import type { ShellGitInfo } from '../screens/settings-screen'
import { useMobileTheme } from '../theme/context'

const fmt = (n: number) => n.toLocaleString()

/**
 * Switch the project checkout to another branch, or create one from HEAD.
 * Laid out like the desktop branch popover in `ChatStatusBar`: search, then
 * the current branch on its own carrying the dirty summary, then the rest,
 * then the create row. Both actions mutate the paired desktop's repository,
 * so failures surface in place rather than dismissing the sheet.
 */
export function BranchPicker(props: {
  branches: string[]
  currentBranch?: string | null
  dirty?: ShellGitInfo['dirty']
  onSwitch: (branch: string) => Promise<void>
  onCreate: (branch: string) => Promise<void>
  onDone: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const matches = filterBranches(props.branches, query)
  const current = props.currentBranch && matches.includes(props.currentBranch) ? props.currentBranch : null
  const others = matches.filter((branch) => branch !== props.currentBranch)
  const creatable = branchToCreate(props.branches, query)
  const run = async (branch: string, action: (branch: string) => Promise<void>) => {
    if (busy) return
    setBusy(branch)
    setError('')
    try {
      await action(branch)
      props.onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change branch')
    } finally {
      setBusy('')
    }
  }
  const row = (key: string, label: string, onPress: () => void, disabled: boolean, body: ReactNode, trailing?: ReactNode) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || !!busy }} disabled={disabled || !!busy} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm,
        opacity: busy && busy !== key ? 0.45 : 1, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      <GitBranch size={16} color={colors.mutedForeground} />
      <View style={{ flex: 1, minWidth: 0 }}>{body}</View>
      {busy === key ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : trailing}
    </Pressable>
  )
  const separator = <View style={{ height: 1, marginVertical: 4, backgroundColor: colors.border }} />
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10,
        borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Search size={15} color={colors.mutedForeground} />
        <TextInput value={query} onChangeText={setQuery} accessibilityLabel="Search branches"
          placeholder="Search or create branch…" placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none" autoCorrect={false}
          style={{ flex: 1, minHeight: 44, fontSize: 14, color: colors.foreground }} />
      </View>
      {error ? <Text accessibilityRole="alert" style={{ paddingHorizontal: 10, fontSize: 12, color: colors.destructive }}>{error}</Text> : null}
      <View>
        {!current && !others.length && !creatable ? (
          <Text style={{ padding: 12, fontSize: 13, textAlign: 'center', color: colors.mutedForeground }}>No branches found</Text>
        ) : null}
        {current ? row(current, current, () => {}, true, (
          <>
            <Text numberOfLines={1} style={{ fontSize: 14, color: colors.foreground }}>{current}</Text>
            {props.dirty ? <DirtySummary dirty={props.dirty} /> : null}
          </>
        ), <Check size={16} color={colors.primary} />) : null}
        {others.length ? <>
          {current ? separator : null}
          {others.map((branch) => row(branch, branch, () => { void run(branch, props.onSwitch) }, false,
            <Text numberOfLines={1} style={{ fontSize: 14, color: colors.foreground }}>{branch}</Text>))}
        </> : null}
        {creatable ? <>
          {current || others.length ? separator : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Create branch ${creatable}`} disabled={!!busy}
            onPress={() => { void run(creatable, props.onCreate) }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44,
              paddingHorizontal: 10, borderRadius: radius.sm, opacity: busy && busy !== creatable ? 0.45 : 1,
              backgroundColor: pressed ? colors.muted : 'transparent' })}>
            <Plus size={16} color={colors.mutedForeground} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: colors.mutedForeground }}>
              Create branch: <Text style={{ fontWeight: '600', color: colors.foreground }}>{creatable}</Text>
            </Text>
            {busy === creatable ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
          </Pressable>
        </> : null}
      </View>
    </View>
  )
}

/** `uncommitted: 27 files +1,231 -75`, exactly as the desktop popover reads. */
function DirtySummary({ dirty }: { dirty: NonNullable<ShellGitInfo['dirty']> }) {
  const { tokens: { colors } } = useMobileTheme()
  return (
    <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedForeground }}>
      uncommitted: {fmt(dirty.files)} {dirty.files === 1 ? 'file' : 'files'}
      {dirty.insertions > 0 ? <Text style={{ color: colors.success }}> +{fmt(dirty.insertions)}</Text> : null}
      {dirty.deletions > 0 ? <Text style={{ color: colors.error }}> -{fmt(dirty.deletions)}</Text> : null}
    </Text>
  )
}
