import type { ReactNode } from 'react'
import type { ComposerId } from './resolve-composer'
import type { DecisionQueueItem } from './decision-queue'
import { ChatComposerShell } from '../ChatComposerShell'
import { DecisionComposer } from '../DecisionComposer'
import { RealtimeCallComposer } from '../RealtimeCallComposer'
import { McpAppConsentComposer } from '@/components/mcp-apps/McpAppConsent'
import type { PendingMcpConsent } from '@/components/mcp-apps/consent-store'

export interface ComposerRenderOptions {
  showTodoPopup: boolean
  autoFocusOnMount: boolean
  onBaseComposerMounted: () => void
  microphoneShortcutEnabled: boolean
  decision?: DecisionQueueItem | null
  appConsent?: PendingMcpConsent
}

type ComposerFactory = (sessionId: string, options: ComposerRenderOptions) => ReactNode

const composerRegistry: Record<ComposerId, ComposerFactory> = {
  decision: (_sessionId, options) => <DecisionComposer item={options.decision} />,
  'app-consent': (sessionId, options) => <McpAppConsentComposer sessionId={sessionId} pending={options.appConsent} />,
  voice: (_sessionId, options) => (
    <RealtimeCallComposer microphoneShortcutEnabled={options.microphoneShortcutEnabled} />
  ),
  text: (_sessionId, options) => (
    <ChatComposerShell
      showTodoPopup={options.showTodoPopup}
      autoFocusOnMount={options.autoFocusOnMount}
      onMounted={options.onBaseComposerMounted}
    />
  ),
}

export function renderComposer(
  id: ComposerId,
  sessionId: string,
  options: ComposerRenderOptions,
): ReactNode {
  return composerRegistry[id](sessionId, options)
}
