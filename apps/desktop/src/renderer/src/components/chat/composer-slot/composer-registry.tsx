import { useRef, type ComponentType, type ReactNode } from 'react'
import { COMPOSER_IDS, type BuiltinComposerId, type ComposerId } from './resolve-composer'
import type { DecisionQueueItem } from './decision-queue'
import { ChatComposerShell } from '../ChatComposerShell'
import { DecisionComposer } from '../DecisionComposer'
import { InputRequestComposer } from '../InputRequestComposer'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { RealtimeCallComposer } from '../RealtimeCallComposer'
import { McpAppConsentComposer } from '@/components/mcp-apps/McpAppConsent'
import { useHasMcpAppConsent } from '@/components/mcp-apps/consent-store'
import type { PendingMcpConsent } from '@/components/mcp-apps/consent-store'
import { useActiveSession, type SessionWriteTarget } from '@/stores/chat'
import { useDecisionComposerAvailability } from './useDecisionComposerAvailability'
import {
  cancelComposer, clearSessionComposers, composerStackFor, pushComposer,
  removeRegisteredComposer, submitComposer, updateComposerValue, useComposerStacks,
  type ComposerHandle, type ComposerLifetime, type ComposerValue, type OpenComposerOptions,
} from './composer-stack'

export const COMPOSER_CONTENT_MAX_HEIGHT = 'min(45vh, 440px)'

export interface OpenedComposerProps {
  instanceId: string
  lifetime: ComposerLifetime
  session: SessionWriteTarget
  value: ComposerValue
  onValueChange: (value: ComposerValue) => void
  active: boolean
  submit: (value: ComposerValue) => void
  cancel: () => void
}

const registeredComposers = new Map<string, ComponentType<OpenedComposerProps>>()

/** Registers an in-process native composer. Unregistering cancels its open requests. */
export function registerComposer(id: string, component: ComponentType<OpenedComposerProps>): () => void {
  if (!id.trim() || COMPOSER_IDS.some(builtin => builtin === id) || registeredComposers.has(id)) {
    throw new Error(`Composer id is unavailable: ${id}`)
  }
  registeredComposers.set(id, component)
  let registered = true
  return () => {
    if (!registered) return
    registered = false
    registeredComposers.delete(id)
    removeRegisteredComposer(id)
  }
}

/** Capture the owner now; a later project/session switch never redirects a request. */
export function composerForSession(target: SessionWriteTarget) {
  const owner = { ...target }
  return {
    open: (id: string, options?: OpenComposerOptions): Promise<ComposerValue | null> => registeredComposers.has(id)
      ? pushComposer(owner, id, options)
      : Promise.reject(new Error(`Composer is not registered: ${id}`)),
    returnToChat: () => clearSessionComposers(owner),
  }
}

function OpenedComposer({ entry, Component }: { entry: ComposerHandle; Component: ComponentType<OpenedComposerProps> }) {
  const stack = useComposerStacks(state => composerStackFor(entry.target, state))
  const current = stack.base?.key === entry.key ? stack.base : stack.stack.find(item => item.key === entry.key)
  const lastValue = useRef(current?.value ?? {})
  if (current) lastValue.current = current.value
  const top = stack.stack.at(-1) ?? stack.base
  const needsDecision = useActiveSession(session => session.pendingPermissions.length > 0 || !!session.pendingQuestion || !!session.pendingPlanApproval)
  const available = useDecisionComposerAvailability()
  const appConsent = useHasMcpAppConsent(entry.target.sessionId)
  const active = top?.key === entry.key && available && !needsDecision && !appConsent
  return (
    <div inert={!active} data-opened-composer={entry.id} className="min-h-0 overflow-y-auto" style={{ maxHeight: COMPOSER_CONTENT_MAX_HEIGHT }}>
      <Component
        instanceId={entry.key}
        lifetime={entry.lifetime}
        session={entry.target}
        value={lastValue.current}
        onValueChange={value => updateComposerValue(entry, value)}
        active={active}
        submit={value => { if (active) submitComposer(entry, value) }}
        cancel={() => { if (active) cancelComposer(entry) }}
      />
    </div>
  )
}

export interface ComposerRenderOptions {
  showTodoPopup: boolean
  autoFocusOnMount: boolean
  onBaseComposerMounted: () => void
  microphoneShortcutEnabled: boolean
  decision?: DecisionQueueItem | null
  appConsent?: PendingMcpConsent
  appInput?: PermissionRequest | null
  openedComposer?: ComposerHandle | null
}

type ComposerFactory = (sessionId: string, options: ComposerRenderOptions) => ReactNode

const composerRegistry: Record<BuiltinComposerId, ComposerFactory> = {
  decision: (_sessionId, options) => <DecisionComposer item={options.decision} />,
  'app-consent': (sessionId, options) => <McpAppConsentComposer sessionId={sessionId} pending={options.appConsent} />,
  'app-input': (_sessionId, options) => <InputRequestComposer request={options.appInput} />,
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
  if (COMPOSER_IDS.some(builtin => builtin === id)) return composerRegistry[id as BuiltinComposerId](sessionId, options)
  const Component = registeredComposers.get(id)
  const entry = options.openedComposer
  return Component && entry?.id === id ? <OpenedComposer key={entry.key} entry={entry} Component={Component} /> : null
}
