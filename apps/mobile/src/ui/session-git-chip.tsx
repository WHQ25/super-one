import { GitBranch, GitCommitHorizontal, TriangleAlert } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { Text } from './text'
import { sessionGitLabel, type SessionGitView } from '../session-git-status'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

/**
 * The checkout the running session is on, shown under the chat title.
 *
 * Only the plain-branch case is tappable, and that mirrors the desktop: a
 * worktree is fixed for the session's lifetime, so offering a branch switch
 * there would open a picker that cannot apply to what the user is looking at.
 */
export function SessionGitChip(props: {
  view: SessionGitView
  fontSize?: number
  iconSize?: number
  /** Omitted (or given on a worktree) leaves the chip a read-only label. */
  onPress?: () => void
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const fontSize = props.fontSize ?? 11
  const iconSize = props.iconSize ?? 12
  const missing = props.view.kind === 'worktreeMissing'
  const tint = missing ? colors.warning : colors.mutedForeground
  const label = sessionGitLabel(props.view)
  const tappable = props.view.kind === 'branch' && !!props.onPress
  const body = (
    <>
      {props.view.kind === 'worktreeBranch' || props.view.kind === 'worktreeDetached'
        ? <Text style={{ color: colors.mutedForeground, fontSize }}>{t('Worktree')}</Text>
        : null}
      <Mark view={props.view} size={iconSize} color={tint} />
      <Text numberOfLines={1} style={{ color: tint, fontSize, flexShrink: 1 }}>{t(text(props.view))}</Text>
      {props.view.kind === 'branch' && props.view.dirtyFiles > 0
        ? <View accessibilityLabel={t('Uncommitted changes')}
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning }} />
        : null}
    </>
  )
  if (!tappable) {
    return <View accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>{body}</View>
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={props.onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1,
        paddingHorizontal: 3, borderRadius: radius.sm, backgroundColor: pressed ? colors.muted : 'transparent' })}>
      {body}
    </Pressable>
  )
}

function Mark({ view, size, color }: { view: SessionGitView; size: number; color: string }) {
  if (view.kind === 'worktreeMissing') return <TriangleAlert size={size} color={color} />
  // Same split as the desktop's `workDirIcon`: a detached checkout is a commit,
  // everything else is a branch.
  const Icon = view.kind === 'detached' || view.kind === 'worktreeDetached'
    ? GitCommitHorizontal
    : GitBranch
  return <Icon size={size} color={color} />
}

function text(view: SessionGitView): string {
  switch (view.kind) {
    case 'branch': case 'worktreeBranch': return view.branch
    case 'detached': case 'worktreeDetached': return view.head
    case 'worktreeMissing': return 'Worktree missing'
  }
}
