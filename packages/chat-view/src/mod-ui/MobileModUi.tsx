import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { ModHostReply, ModHostRequest, ModUiOp, ModUiRequest, ModUiResult } from '@superone/shared/mod-ui'
import { requestNative, requestNativeAsync } from '../bridge'
import { NativeWebLink, PlainCode, PortableMarkdown } from '../PortableMarkdown'
import { ModUiClient } from './client'
import { measureCell } from './cells'
import type { ModUiPorts } from './ModTree'
import { ModSurfaceFrame, ModUiProvider, useModUi, useModUiState } from './react'

/** The relay adds its own wait on top of the CLI's 15 s. */
const MOD_UI_TIMEOUT_MS = 25_000

function phoneViewport() {
  const cell = measureCell()
  // Panes open as a sheet over the transcript, so the CLI may always place one.
  return { columns: Math.max(20, Math.floor(window.innerWidth / cell.width)), rows: Math.max(10, Math.floor(window.innerHeight / cell.height)), isFullscreen: true }
}

/** What the phone answers for a plugin: the clipboard, and a replacing composer fill. */
async function answerOnPhone(request: ModHostRequest): Promise<ModHostReply> {
  switch (request.kind) {
    case 'copy':
      return { kind: 'copy', copied: await requestNativeAsync('copyText', { text: request.text }).then(() => true, () => false) }
    case 'promptFill':
      // The native composer takes a whole draft; it cannot splice at a caret.
      if (request.mode !== 'replace') return { kind: 'promptFill', filled: false }
      return { kind: 'promptFill', filled: await requestNativeAsync('setDraft', { text: request.text }).then(() => true, () => false) }
    case 'promptRead':
      return { kind: 'promptRead', text: '', cursor: 0 }
    case 'promptSuggest':
      return { kind: 'promptSuggest', shown: false }
  }
}

export function createMobileModClient(clientId: string): ModUiClient {
  return new ModUiClient({
    surface: 'mobile',
    clientId,
    answers: ['copy', 'promptFill'],
    transport: async <O extends ModUiOp>(op: O, request: ModUiRequest<O>) => {
      const result = await requestNativeAsync('modUi', { op, request }, MOD_UI_TIMEOUT_MS) as { response?: ModUiResult<O> }
      return result.response as ModUiResult<O>
    },
    hostHandler: answerOnPhone,
    viewport: phoneViewport,
  })
}

/**
 * The document's mod client for the session native names (`setModSession`),
 * fed the `mod_*` events native forwards (`modEvent`).
 */
export function useMobileModClient(): { client: ModUiClient | null; setSession: (s: { sessionId: string | null; clientId: string | null }) => void; handleEvent: (event: AgentEvent) => void } {
  const [session, setSession] = useState<{ sessionId: string | null; clientId: string | null }>({ sessionId: null, clientId: null })
  const client = useMemo(() => (session.sessionId && session.clientId ? createMobileModClient(session.clientId) : null), [session.sessionId, session.clientId])
  useEffect(() => {
    if (!client) return
    void client.attach()
    return () => client.dispose()
  }, [client])
  return useMemo(() => ({ client, setSession, handleEvent: (event: AgentEvent) => client?.handleEvent(event) }), [client])
}

export function MobileModUiProvider({ client, scheme, children }: { client: ModUiClient | null; scheme: 'light' | 'dark'; children: ReactNode }) {
  const ports = useMemo<ModUiPorts>(() => ({
    renderMarkdown: (text) => <PortableMarkdown text={text} isStreaming={false} scheme={scheme} />,
    renderCode: ({ source }) => <PlainCode>{source}</PlainCode>,
    openLink: (url) => { requestNative('openLink', { url }) },
    renderLink: (href, children) => <NativeWebLink href={href} scheme={scheme}>{children}</NativeWebLink>,
  }), [scheme])
  return <ModUiProvider client={client} ports={ports}>{children}</ModUiProvider>
}

/**
 * Panes a mod opened, at the top of the bottom dock: tabs when several, a
 * close button, at most half the screen tall.
 */
export function MobileModPanes() {
  const ctx = useModUi()
  const { t } = useTranslation()
  const { available, roster } = useModUiState()
  const shown = roster.panes.find((p) => p.id === roster.shownId) ?? roster.panes.at(-1)
  const props = useMemo(() => ({ title: shown?.title ?? '', placement: 'sheet', view: {} }), [shown?.title])
  if (!ctx || !available || !shown) return null
  const act = <O extends ModUiOp>(op: O, request: ModUiRequest<O>) => void ctx.client.act(op, request)
  return (
    <section className="flex max-h-[50vh] flex-col border-b border-border/60 bg-background" data-mod-sheet="">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {roster.panes.map((pane) => (
            <button
              key={pane.id}
              type="button"
              className={`shrink-0 rounded-md px-2 py-1 text-xs ${pane.id === shown.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}
              onClick={() => act('paneShow', { id: pane.id, surface: ctx.client.surface, clientId: ctx.client.clientId })}
            >
              {pane.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t('chat.mods.closePane')}
          className="rounded-md p-1 text-muted-foreground"
          onClick={() => act('close', { id: shown.id, clientId: ctx.client.clientId })}
        >
          <X className="size-4" />
        </button>
      </header>
      <ModSurfaceFrame
        key={shown.id}
        component="Pane"
        instanceId={shown.id}
        plugin={shown.plugin}
        props={props}
        viewport={phoneViewport()}
        className="min-h-0 flex-1 px-3 py-2"
      />
    </section>
  )
}
