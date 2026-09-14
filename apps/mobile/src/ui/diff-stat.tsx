import { Text } from './text'
import type { GitDirtyStatus } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

const fmt = (n: number) => n.toLocaleString()

/**
 * Inline `N files +ins -del`, exactly as the desktop `DiffStat` reads. Nests
 * inside the caller's `<Text>` so the file count inherits its colour while the
 * line counts keep the success / error tones.
 */
export function DiffStat({ dirty }: { dirty: GitDirtyStatus }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  return (
    <>
      {fmt(dirty.files)} {t(dirty.files === 1 ? 'file' : 'files')}
      {dirty.insertions > 0 ? <Text style={{ color: colors.success }}> +{fmt(dirty.insertions)}</Text> : null}
      {dirty.deletions > 0 ? <Text style={{ color: colors.error }}> -{fmt(dirty.deletions)}</Text> : null}
    </>
  )
}
