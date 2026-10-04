import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModClientLocation, ModClientModuleBundle, ModElement, ModUiOp, ModUiRequest, ModUiResult } from '@superone/shared/mod-ui'
import { cols, measureCell, rows, textStyle } from './cells'
import {
  CLIENT_TIMER_FLOOR_MS,
  clientFrameDocument,
  clientKeyEvent,
  clientPointerEvent,
  importClientTree,
  type ClientPointerEvent,
  type FrameMessage,
  type HostMessage,
} from './client-frame'
import { ModTree, type ModTreeEnv } from './ModTree'

/** More drawings than this in a second is a render loop. */
const MAX_TREES_PER_SECOND = 120
/** Each `surface.post` is a round trip to the CLI. */
const MAX_POSTS_PER_SECOND = 60
/** Each live timer runs on the host's clock. */
const MAX_TIMERS = 32

/** Records one event at `now`; whether more than `max` fell in the last second. */
function overRate(times: number[], max: number): boolean {
  const now = performance.now()
  times.push(now)
  while (times.length > 0 && times[0]! < now - 1000) times.shift()
  return times.length > max
}

type ClientElement = Extract<ModElement, { type: 'Client' }>

function sizeStyle(props: ClientElement['props']): CSSProperties {
  return { width: cols(props.width), height: rows(props.height), flexGrow: props.flexGrow }
}

/** A `Client` element: its plugin's surface module, run in a sandboxed frame. */
export function ClientFrame({ node, env }: { node: ClientElement; env: ModTreeEnv }) {
  const plugin = node.client.plugin
  const hash = env.clientModules?.[plugin] ?? ''
  const [bundle, setBundle] = useState<ModClientModuleBundle | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const { t } = useTranslation()

  useEffect(() => {
    let live = true
    setFault(null)
    void env.client.clientBundle(plugin, hash).then((b) => {
      if (!live) return
      if (b) setBundle(b)
      else setFault('its surface modules did not load')
    })
    return () => {
      live = false
    }
  }, [env.client, plugin, hash])

  const style = useMemo(() => sizeStyle(node.props), [node.props])
  if (fault) {
    return <span style={{ ...textStyle({ dimColor: true }), ...style }}>{t('chat.mods.clientFault', { plugin, message: fault })}</span>
  }
  if (!bundle) return <div style={style} />
  return <RunningClient key={`${bundle.hash}:${node.props.module}`} node={node} env={env} bundle={bundle} style={style} onFault={setFault} />
}

function RunningClient({ node, env, bundle, style, onFault }: { node: ClientElement; env: ModTreeEnv; bundle: ModClientModuleBundle; style: CSSProperties; onFault: (message: string) => void }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [tree, setTree] = useState<ModElement | null>(null)
  const [listens, setListens] = useState({ pointer: false, key: false })
  const [size, setSize] = useState<{ columns: number; rows: number } | null>(null)
  const cell = useMemo(() => measureCell(), [])
  const plugin = node.client.plugin
  const location: ModClientLocation = useMemo(
    () => ({ plugin, component: env.component, instanceId: env.instanceId, client: node.props.key, module: node.props.module }),
    [plugin, env.component, env.instanceId, node.props.key, node.props.module],
  )
  const latest = useRef({ env, location })
  latest.current = { env, location }
  const dead = useRef(false)
  const die = (message: string) => {
    if (dead.current) return
    dead.current = true
    onFault(message)
  }

  // A frame's message listener exists once its document loaded; until then messages wait.
  const frame = useRef<{ loaded: boolean; queue: HostMessage[] }>({ loaded: false, queue: [] })
  const post = (m: HostMessage) => {
    if (!frame.current.loaded) frame.current.queue.push(m)
    else iframeRef.current?.contentWindow?.postMessage(m, '*')
  }
  // The document only loads once: a second load is the frame navigating itself elsewhere.
  const onLoad = () => {
    if (frame.current.loaded) return die('it navigated away')
    frame.current.loaded = true
    for (const m of frame.current.queue.splice(0)) post(m)
  }

  // The frame starts with the size measured on first layout; later changes are sent.
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setSize({ columns: Math.max(1, Math.floor(el.clientWidth / cell.width)), rows: Math.max(1, Math.floor(el.clientHeight / cell.height)) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cell.width, cell.height])
  // The frame starts with the first measured size and the props then; later ones are messages.
  const [srcdoc, setSrcdoc] = useState<string | null>(null)
  const sent = useRef<{ size: { columns: number; rows: number } | null; props: unknown }>({ size: null, props: node.props.props ?? null })
  useEffect(() => {
    if (!size) return
    const was = sent.current.size
    sent.current.size = size
    if (!was) setSrcdoc(clientFrameDocument({ bundle, module: node.props.module, props: sent.current.props, ...size }))
    else if (was.columns !== size.columns || was.rows !== size.rows) post({ t: 'resize', ...size })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size])
  useEffect(() => {
    const props = node.props.props ?? null
    if (JSON.stringify(props) === JSON.stringify(sent.current.props)) return
    sent.current.props = props
    post({ t: 'setProps', props })
  }, [node.props.props])

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setInterval>>()
    const drawings: number[] = []
    const posts: number[] = []
    let shown: number[] = []
    const onMessage = (e: MessageEvent<FrameMessage>) => {
      // An opaque frame's origin is 'null'; any other is a document the frame navigated to.
      if (dead.current || !iframeRef.current || e.source !== iframeRef.current.contentWindow) return
      if (e.origin !== 'null') return die('it navigated away')
      const m = e.data
      if (!m || typeof m !== 'object') return
      const { env: currentEnv, location: at } = latest.current
      switch (m.t) {
        case 'tree': {
          if (overRate(drawings, MAX_TREES_PER_SECOND)) return die('it redrew in a loop')
          const imported = importClientTree(m.text, at.plugin, bundle.limits)
          if ('fault' in imported) return die(imported.fault)
          const retired = shown.filter((h) => !imported.handles.includes(h))
          shown = imported.handles
          if (retired.length > 0) post({ t: 'dropHeld', handles: retired })
          setTree(imported.tree)
          setListens((prev) => (prev.pointer === m.pointer && prev.key === m.key ? prev : { pointer: m.pointer === true, key: m.key === true }))
          return
        }
        case 'post': {
          if (overRate(posts, MAX_POSTS_PER_SECOND)) return die('it posted in a loop')
          let data: unknown
          try {
            data = JSON.parse(m.text)
          } catch {
            return
          }
          void currentEnv.client.act('message', { ...at, data }).then((r) => {
            if (r?.props === undefined || dead.current) return
            sent.current.props = r.props
            post({ t: 'setProps', props: r.props })
          })
          return
        }
        case 'timer':
          if (m.op === 'start' && Number.isInteger(m.timer) && !timers.has(m.timer)) {
            if (timers.size >= MAX_TIMERS) return die('it started too many timers')
            const ms = Math.max(CLIENT_TIMER_FLOOR_MS, Number.isFinite(m.ms) ? m.ms : 0)
            timers.set(m.timer, setInterval(() => post({ t: 'tick', timer: m.timer }), ms))
          } else if (m.op === 'stop') {
            clearInterval(timers.get(m.timer))
            timers.delete(m.timer)
          }
          return
        case 'fault':
          return die(typeof m.message === 'string' ? m.message.slice(0, 300) : 'it failed')
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      for (const timer of timers.values()) clearInterval(timer)
    }
  }, [bundle, onFault])

  // Pressables in the Client's tree reach its module through `ui_client_press`.
  const clientEnv = useMemo<ModTreeEnv>(() => {
    const act = async <O extends ModUiOp>(op: O, request: ModUiRequest<O>): Promise<ModUiResult<O> | null> => {
      const r = request as { handle: number; key: string; kind?: 'change' | 'submit'; value?: string }
      const event =
        op === 'press' ? { type: 'press' as const }
        : op === 'input' ? { type: 'input' as const, kind: r.kind!, value: r.value ?? '' }
        : op === 'select' ? { type: 'select' as const, value: r.value ?? '' }
        : null
      if (!event) return null
      const result = await env.client.act('clientPress', { ...location, element: r.key, event })
      if (result?.handled) post({ t: 'held', handle: r.handle, event: { ...event, ...result.reached } })
      return { handled: result?.handled === true } as ModUiResult<O>
    }
    return { ...env, act: act as ModTreeEnv['act'], renderEngine: undefined }
  }, [env, location])

  const pointer = (type: ClientPointerEvent['type']) => (e: PointerEvent<HTMLDivElement>) => {
    if (!listens.pointer || !boxRef.current) return
    if (type === 'down' && listens.key) boxRef.current.focus()
    post({ t: 'pointer', event: clientPointerEvent(type, e, boxRef.current.getBoundingClientRect(), cell) })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!listens.key || e.target !== boxRef.current) return
    // As in the terminal: Escape and Ctrl+C hand the keys back to the surface.
    // The surface does not see them too (its Escape would close the pane).
    if (e.key === 'Escape' || (e.ctrlKey && (e.key === 'c' || e.key === 'd'))) {
      e.stopPropagation()
      boxRef.current.blur()
      return
    }
    if (e.nativeEvent.isComposing) return
    const event = clientKeyEvent(e)
    if (!event) return
    e.preventDefault()
    e.stopPropagation()
    post({ t: 'key', event })
  }

  return (
    <div
      ref={boxRef}
      data-mod-client={node.props.key}
      className="relative flex min-w-0 flex-col overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-ring"
      style={style}
      tabIndex={listens.key ? 0 : undefined}
      onPointerDown={pointer('down')}
      onPointerUp={pointer('up')}
      onPointerMove={pointer('move')}
      onPointerEnter={pointer('enter')}
      onPointerLeave={pointer('leave')}
      onKeyDown={onKeyDown}
    >
      {tree ? <ModTree tree={tree} env={clientEnv} /> : null}
      {srcdoc ? (
        <iframe
          ref={iframeRef}
          title={`${node.client.plugin} ${node.props.module}`}
          srcDoc={srcdoc}
          sandbox="allow-scripts"
          onLoad={onLoad}
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none absolute size-px opacity-0"
        />
      ) : null}
    </div>
  )
}
