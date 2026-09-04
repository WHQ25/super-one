import {
  BrowserPageToolCallBlockPresenter,
  BrowserPageToolsListBlockPresenter,
  type BrowserPageToolsBlockPresenterProps,
} from '@superone/chat-view/presenters/BrowserPageToolsBlock'
import { BrowserFavicon } from '@/components/browser/BrowserFavicon'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { useBrowserStore } from '@/stores/browser'
import { ToolIcon } from './ToolIcon'
import { PrettyJSONCodeBlock } from './tool-result-views'

export interface BrowserPageToolsBlockProps extends Omit<
  BrowserPageToolsBlockPresenterProps,
  'elapsedClassName' | 'renderPageIcon' | 'renderJson'
> {
  stallLevel: StallLevel
}

function PageIcon({ origin, tabId }: { origin?: string; tabId?: string }) {
  const tabUrl = useBrowserStore((state) => (tabId ? state.tabs[tabId]?.url : undefined))
  return (
    <BrowserFavicon
      url={origin || tabUrl || null}
      className="size-3.5 shrink-0"
      fallback={<ToolIcon icon="globe" className="size-3 shrink-0 text-muted-foreground" />}
    />
  )
}

function presenterProps(props: BrowserPageToolsBlockProps): BrowserPageToolsBlockPresenterProps {
  const { stallLevel, ...rest } = props
  return {
    ...rest,
    elapsedClassName: getStallColor(stallLevel),
    renderPageIcon: (identity) => <PageIcon {...identity} />,
    renderJson: (text) => <PrettyJSONCodeBlock text={text} />,
  }
}

export function BrowserPageToolsListBlock(props: BrowserPageToolsBlockProps) {
  return <BrowserPageToolsListBlockPresenter {...presenterProps(props)} />
}

export function BrowserPageToolCallBlock(props: BrowserPageToolsBlockProps) {
  return <BrowserPageToolCallBlockPresenter {...presenterProps(props)} />
}
