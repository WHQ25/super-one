import { View } from 'react-native'
import { Clock, PencilLine, Trash2 } from 'lucide-react-native'
import type { DraftListEntry } from '@superone/shared/environment/draft-rpc'
import { hasPersistableDraftContent } from '@superone/shared/environment/draft-content'
import { Text } from '../ui/text'
import { SwipeRow } from '../ui/swipe-row'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'

export type WorkspaceDraftsProps = {
  drafts: DraftListEntry[]
  activeDraftId?: string | null
  onOpenDraft(draft: DraftListEntry): void
  onDeleteDraft(draft: DraftListEntry): void
}

export function WorkspaceDrafts({ drafts, activeDraftId, onOpenDraft, onDeleteDraft }: WorkspaceDraftsProps) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  const visibleDrafts = drafts.filter(hasPersistableDraftContent)
  if (!visibleDrafts.length) return null
  return <View testID="workspace-drafts">
    {visibleDrafts.map((draft) => <SwipeRow key={draft.id} subject={draft.title || t('Untitled draft')} variant="floating"
      onPress={() => onOpenDraft(draft)} actions={[{ key: 'delete', label: t('Delete draft'), icon: Trash2, tone: 'destructive',
        confirm: { title: t('Delete draft'), message: draft.title || t('Untitled draft'), confirmLabel: t('Delete') },
        onPress: () => onDeleteDraft(draft) }]}>
      {({ revealed }) => <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 38, paddingHorizontal: 12, paddingVertical: 6,
        borderRadius: radius.md, backgroundColor: draft.id === activeDraftId || revealed ? colors.muted : colors.surface }}>
        <PencilLine size={16} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 15, color: colors.foreground,
          fontWeight: draft.id === activeDraftId ? '500' : '400' }}>{draft.title || draft.text.trim() || t('Untitled draft')}</Text>
        {draft.pendingSync ? <Clock size={12} color={colors.warning} accessibilityLabel={t('Pending sync')} /> : null}
      </View>}
    </SwipeRow>)}
  </View>
}
