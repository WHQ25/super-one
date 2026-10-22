import { Trans, useTranslation } from 'react-i18next'
import type { GitDirtyStatus } from '@superone/shared/agent-types'

const fmt = (n: number) => n.toLocaleString()

/** Value equality for two stats — undefined on both sides counts as equal. */
export const sameDirty = (a: GitDirtyStatus | undefined, b: GitDirtyStatus | undefined): boolean =>
  a?.files === b?.files && a?.insertions === b?.insertions && a?.deletions === b?.deletions

/** Inline `N files +ins -del` summary; the caller supplies the wrapping element. */
export function DiffStat({ stat }: { stat: GitDirtyStatus }) {
  const { t } = useTranslation()
  return (
    <>
      {t('chat.worktree.filesCount', { count: stat.files })}
      {stat.insertions > 0 && <span className="ml-1 text-green-500">+{fmt(stat.insertions)}</span>}
      {stat.deletions > 0 && <span className="ml-1 text-red-500">-{fmt(stat.deletions)}</span>}
    </>
  )
}

/** `uncommitted: N files +ins -del` under the checked-out branch. */
export function UncommittedDetail({ stat }: { stat: GitDirtyStatus }) {
  return (
    <span className="text-xs text-muted-foreground">
      <Trans i18nKey="chat.worktree.uncommittedStat" components={{ stat: <DiffStat stat={stat} /> }} />
    </span>
  )
}
