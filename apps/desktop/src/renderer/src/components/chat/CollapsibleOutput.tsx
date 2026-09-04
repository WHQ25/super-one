import { useTranslation } from 'react-i18next'
import {
  CollapsibleOutputPresenter,
  type CollapsibleOutputPresenterProps,
} from './presenters/CollapsibleOutput'

export interface CollapsibleOutputProps {
  text: string
}

/** Desktop i18n adapter for the host-agnostic disclosure presenter. */
export function CollapsibleOutput({ text }: CollapsibleOutputProps) {
  const { t } = useTranslation()
  const lineCount = text.split('\n').length
  return (
    <CollapsibleOutputPresenter
      text={text}
      collapsedLabel={t('chat.toolBlock.outputLines', { count: lineCount })}
      expandedLabel={t('chat.toolBlock.collapseOutput')}
    />
  )
}

export { CollapsibleOutputPresenter }
export type { CollapsibleOutputPresenterProps }
