import { useTranslation } from 'react-i18next'

/**
 * Marks a message the transcript window holds from partway through: its
 * earlier part loads from the top edge, like older history.
 */
export function WindowEarlierPart() {
  const { t } = useTranslation()
  return <div className="px-1 pb-1 text-xs text-muted-foreground" data-testid="window-earlier-part">{t('chat.transcriptWindow.earlierPart')} …</div>
}
