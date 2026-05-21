import { useTranslation } from 'react-i18next'
import type { GitDirtyStatus } from '@superone/shared/agent-types'

const fmt = (n: number) => n.toLocaleString()

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
