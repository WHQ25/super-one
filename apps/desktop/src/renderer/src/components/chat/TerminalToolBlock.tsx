import { useCallback } from 'react'
import {
  TerminalToolBlockPresenter,
  type TerminalToolBlockPresenterProps,
} from '@superone/chat-view/presenters/TerminalToolBlock'
import { revealTerminalTabInActivity } from '@/components/activity/activity-panel-api'

/** Desktop host adapter for the shared terminal presenter: expand can jump to the tab. */
export function TerminalToolBlock(props: Omit<TerminalToolBlockPresenterProps, 'onRevealTab'>) {
  const onRevealTab = useCallback((terminalId: string) => {
    void window.terminal.list().then((items) => {
      const item = items.find((row) => row.terminalId === terminalId)
      if (item && item.status === 'running') revealTerminalTabInActivity(item)
    })
  }, [])
  return <TerminalToolBlockPresenter {...props} onRevealTab={onRevealTab} />
}
