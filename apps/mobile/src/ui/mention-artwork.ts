import { useMemo } from 'react'
import { parseGitMentionValue } from '@superone/shared/git-mention-query'
import { useMobileTheme } from '../theme/context'
import { mentionFileArtwork } from './mention-file-artwork-data'
import { mentionGlyphArtwork } from './mention-glyph-data'
import { mentionBrandArtwork } from './mention-brand-data'
import { dynamicMentionArtwork } from './mention-dynamic-artwork'

export type MentionArtwork = { key: string; png: string }
/** Static images generated from desktop Symbols, Lucide and brand components. No hidden native
 * views or asynchronous exports participate in editing or theme changes. */
export function useMentionArtwork(tokens: readonly { kind: string; value: string }[]) {
  const { tokens: { colors, scheme } } = useMobileTheme()
  const identities = JSON.stringify([...new Map<string, { kind: string; value: string }>(tokens.filter(token => token.kind !== 'paste')
    .map((token) => [`${token.kind}:${token.value}`, { kind: token.kind, value: token.value }] as const))
    .set('paste', { kind: 'paste', value: '' }).entries()])
  return useMemo(() => {
    const rows = JSON.parse(identities) as Array<[string, { kind: string; value: string }]>
    return rows.flatMap(([key, token]): MentionArtwork[] => {
      const png = dynamicMentionArtwork(token.kind, token.value) ?? (token.kind === 'file'
        ? mentionFileArtwork(token.value, false, colors.foreground)
        : token.kind === 'agent-profile' ? mentionBrandArtwork(token.value, scheme, colors.foreground)
        : mentionGlyphArtwork(token.kind === 'desktop-app' ? 'computer'
          : token.kind === 'git' ? `git:${parseGitMentionValue(token.value)?.kind ?? 'branch'}` : token.kind, scheme, colors.foreground))
      return png ? [{ key, png }] : []
    })
  }, [identities, colors.foreground, scheme])
}
