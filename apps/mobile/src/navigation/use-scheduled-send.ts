import { useEffect, useRef, useState } from 'react'
import type { ImageAttachment, ScheduledSend } from '@superone/shared/agent-types'
import type { RelayClient } from '@superone/relay-client'
import type { ChatRuntime } from '../runtime'
import type { useComposerDraft } from './use-composer-draft'
import { MobileScheduledSend, scheduledSessionKey, type ScheduledSendState } from '../scheduled-send-state'

export type ScheduledSendControls = {
  scheduled: ScheduledSend | null
  available: boolean
  loading: boolean
  busy: boolean
  error: string
  schedule: (sendAt: number) => Promise<void>
  accept: () => Promise<void>
  cancel: () => Promise<void>
  dismiss: () => Promise<void>
  retry?: () => Promise<void>
}
type Options = {
  client: RelayClient | null
  connected: boolean
  projectPath: string | null
  sessionId: string | null
  sourceEnvironmentId: string | null
  runtimeRef: { current: ChatRuntime | null }
  composer: ReturnType<typeof useComposerDraft>
  attachments: ImageAttachment[]
  clearAttachments: (sent: ImageAttachment[]) => void
  prepareSession: () => Promise<ChatRuntime | null>
  consumeDraft: () => Promise<void>
  onError: (message: string) => void
}
const fingerprint = (message: string | null, attachments: ImageAttachment[]) => JSON.stringify([message, attachments])

/** Host-owned scheduling; local draft edits are mirrored only after an explicit edit. */
export function useScheduledSend(options: Options) {
  const latest = useRef(options)
  latest.current = options
  const queued = useRef<{ key: string; sendAt: number; fingerprint: string; attachments: ImageAttachment[] } | null>(null)
  const [state, setState] = useState<ScheduledSendState>({ key: '', scheduled: null, supported: false, loading: false, busy: false, error: '' })
  const [controller] = useState(() => new MobileScheduledSend(state => setState(state), (previous, next) => {
    const saved = queued.current
    if (!saved || previous?.sendAt !== saved.sendAt || next?.armed) return
    const opts = latest.current
    const runtime = opts.runtimeRef.current
    if (!runtime || saved.key !== scheduledSessionKey(runtime.sourceEnvironmentId ?? opts.client?.environmentId ?? '', runtime.sessionId)) return
    const draft = opts.composer.capture()
    if (saved.fingerprint !== fingerprint(draft.text.trim() || null, opts.attachments)) return
    opts.composer.clearSent(draft.revision)
    opts.clearAttachments(saved.attachments)
    queued.current = null
  }))
  const [preparing, setPreparing] = useState(false)
  const [actionError, setActionError] = useState('')
  const active = useRef(false)
  const scope = JSON.stringify([options.client?.environmentId, options.projectPath, options.sessionId, options.sourceEnvironmentId])
  const currentScope = useRef(scope)
  currentScope.current = scope
  // The shell publishes an optimistic id before draft preparation and host creation.
  // Session reads must wait until that id belongs to a created runtime.
  const sessionReady = !options.sessionId || (options.runtimeRef.current?.sessionId === options.sessionId
    && !options.runtimeRef.current.isCreatingSession)
  useEffect(() => setActionError(''), [scope])

  useEffect(() => {
    const { client, connected, projectPath, sessionId, sourceEnvironmentId } = options
    let alive = true
    if (client && connected && projectPath && sessionReady) {
      void (async () => {
        const environmentId = sourceEnvironmentId ?? (await client.resolveProject(projectPath)).environmentId
        if (alive) {
          await controller.connect(client, environmentId, sessionId)
          if (alive && controller.state.error) options.onError(controller.state.error)
        }
      })().catch(error => { if (alive) options.onError(error instanceof Error ? error.message : String(error)) })
    } else controller.disconnect()
    return () => { alive = false }
  }, [controller, options.client, options.connected, options.projectPath, options.sessionId, options.sourceEnvironmentId, sessionReady])
  useEffect(() => () => controller.disconnect(), [controller])

  const capture = () => {
    const opts = latest.current
    const draft = opts.composer.capture()
    return { message: draft.text.trim() || null, attachments: opts.attachments.slice() }
  }
  const action = async (run: () => Promise<void>) => {
    const startedScope = currentScope.current
    if (active.current) return
    active.current = true
    setPreparing(true)
    setActionError('')
    try { await run() }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (startedScope === currentScope.current) setActionError(message)
      latest.current.onError(message); throw error
    }
    finally { active.current = false; setPreparing(false) }
  }
  const arm = (sendAt: number, offer: boolean) => action(async () => {
    const before = currentScope.current
    const opts = latest.current
    if (!opts.connected || !opts.client || !controller.state.supported) throw new Error('Scheduled sending is unavailable on this host')
    if (!offer && (!Number.isFinite(sendAt) || sendAt <= Date.now())) throw new Error('Choose a future date and time')
    await opts.composer.editorRef.current?.prepareSubmit()
    if (before !== currentScope.current) return
    const draft = capture()
    const runtime = await opts.prepareSession()
    if (!runtime?.sessionId || runtime !== opts.runtimeRef.current || runtime.projectPath !== opts.projectPath || latest.current.client !== opts.client) return
    const environmentId = runtime.sourceEnvironmentId ?? opts.client.environmentId
    if (!environmentId) throw new Error('No authenticated session')
    await controller.connect(opts.client, environmentId, runtime.sessionId)
    queued.current = { key: scheduledSessionKey(environmentId, runtime.sessionId), sendAt, fingerprint: fingerprint(draft.message, draft.attachments), attachments: draft.attachments }
    await controller.write({ sendAt, armed: true, source: offer ? 'rate_limit' : 'manual',
      ...(!offer || draft.message || draft.attachments.length ? { message: draft.message, attachments: draft.attachments } : {}) })
    if (runtime !== opts.runtimeRef.current || latest.current.client !== opts.client || controller.state.key !== scheduledSessionKey(environmentId, runtime.sessionId)) return
    await opts.consumeDraft()
  })

  useEffect(() => {
    if (!state.scheduled?.armed || !options.connected) return
    let previous = queued.current?.key === state.key ? queued.current.fingerprint : fingerprint(capture().message, latest.current.attachments)
    let retryAfter = 0
    let reportedError = ''
    const timer = setInterval(() => {
      const opts = latest.current
      const runtime = opts.runtimeRef.current
      if (!runtime || controller.state.key !== scheduledSessionKey(runtime.sourceEnvironmentId ?? opts.client?.environmentId ?? '', runtime.sessionId)
        || controller.state.busy || active.current || Date.now() < retryAfter) return
      const draft = capture()
      const next = fingerprint(draft.message, draft.attachments)
      if (previous === next) return
      previous = next
      const scheduled = controller.state.scheduled
      if (!scheduled?.armed) return
      const key = controller.state.key
      void controller.write({ message: draft.message, attachments: draft.attachments }).then(() => {
        queued.current = { key, sendAt: scheduled.sendAt, fingerprint: next, attachments: draft.attachments }
        reportedError = ''
      }).catch(error => {
        previous = ''; retryAfter = Date.now() + 5000
        const message = error instanceof Error ? error.message : String(error)
        if (reportedError !== message) latest.current.onError(message)
        reportedError = message
      })
    }, 800)
    return () => clearInterval(timer)
  }, [controller, state.key, state.scheduled?.armed, options.connected])

  const current = sessionReady && state.key === scheduledSessionKey(options.sourceEnvironmentId ?? options.client?.environmentId ?? '', options.sessionId)
  const controls: ScheduledSendControls = {
    scheduled: current ? state.scheduled : null, loading: !current || state.loading, busy: state.busy || preparing, error: current ? actionError || state.error : '',
    available: current && options.connected && state.supported && !state.loading,
    schedule: (sendAt) => arm(sendAt, false),
    accept: () => state.scheduled ? arm(state.scheduled.sendAt, true) : Promise.resolve(),
    cancel: () => action(() => controller.write(state.scheduled?.source === 'rate_limit' ? { armed: false } : null)),
    dismiss: () => action(() => controller.write(null)),
    retry: () => action(async () => {
      const before = currentScope.current
      const opts = latest.current
      if (!opts.client || !opts.projectPath || !opts.connected) return
      const environmentId = opts.sourceEnvironmentId ?? (await opts.client.resolveProject(opts.projectPath)).environmentId
      if (before !== currentScope.current) return
      await controller.connect(opts.client, environmentId, opts.sessionId, true)
    }),
  }
  return { controls, ingest: (events: unknown[]) => controller.ingest(events) }
}
