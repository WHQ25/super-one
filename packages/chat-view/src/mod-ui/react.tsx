import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EMPTY_MOD_PANE_ROSTER, MOD_BACKDROP_INSTANCE, MOD_THEME_INSTANCE, type ModKeyedRow, type ModPlacedRow, type ModRenderComponent, type ModRenderResult, type ModScrollComponent } from '@superone/shared/mod-ui'
import type { ModSiteLayout, ModSiteSnapshot, ModUiClient, ModUiClientState } from './client'
import { MOD_PALETTE_STYLE, measureCell } from './cells'
import { ModTree, countEngineRefs, firstEngineRef, pressModHotkey, type ModTreeEnv, type ModUiPorts } from './ModTree'
import { modBackdropGlassStyle, parseModBackdropProps, parseModThemeStyle } from './theme'
import { isDrawableModTree } from './validate'

interface ModUiContextValue {
  client: ModUiClient
  ports: ModUiPorts
}

const ModUiContext = createContext<ModUiContextValue | null>(null)

/** Makes one session's mod client available to every site below. */
export function ModUiProvider({ client, ports, children }: { client: ModUiClient | null; ports: ModUiPorts; children: ReactNode }) {
  const value = useMemo(() => (client ? { client, ports } : null), [client, ports])
  return <ModUiContext.Provider value={value}>{children}</ModUiContext.Provider>
}

export function useModUi(): ModUiContextValue | null {
  return useContext(ModUiContext)
}

const ModMessageContext = createContext<string | null>(null)

/** Names the transcript message below, so its blocks get stable instance ids. */
export function ModMessageScope({ messageId, children }: { messageId: string; children: ReactNode }) {
  return <ModMessageContext.Provider value={messageId}>{children}</ModMessageContext.Provider>
}

/** The enclosing message's id, or null outside a `ModMessageScope`. */
export function useModMessageId(): string | null {
  return useContext(ModMessageContext)
}

const OFF_STATE: ModUiClientState = { available: false, roster: EMPTY_MOD_PANE_ROSTER, placed: [] }
const noopSubscribe = () => () => {}

/** Whether the session draws mods, and its pane roster. */
export function useModUiState(client: ModUiClient | null | undefined = useModUi()?.client): ModUiClientState {
  const read = () => client?.getState() ?? OFF_STATE
  // Server rendering (static transcript exports, tests) reads the same store.
  return useSyncExternalStore(client ? (cb) => client.subscribe(cb) : noopSubscribe, read, read)
}

const OFF_SNAPSHOT: ModSiteSnapshot = { status: 'off', result: null, props: {} }

/** Keeps one site asked for while mounted and returns what the CLI drew there. */
export function useModSite(component: ModRenderComponent, instanceId: string, props: Record<string, unknown>, layout: ModSiteLayout = {}): ModSiteSnapshot {
  const client = useModUi()?.client ?? null
  const latest = useRef({ props, layout })
  latest.current = { props, layout }
  const subscribe = useCallback(
    (cb: () => void) => (client ? client.observe(component, instanceId, latest.current.props, latest.current.layout, cb) : () => {}),
    [client, component, instanceId],
  )
  const read = () => client?.snapshot(component, instanceId) ?? OFF_SNAPSHOT
  const snapshot = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    client?.update(component, instanceId, props, layout)
  })
  return snapshot
}

/** Draws `fallback` once a tree throws, until the next tree arrives (a fixed plugin draws again). */
class TreeBoundary extends Component<{ tree: unknown; fallback: ReactNode; children: ReactNode }, { failed: boolean; tree: unknown }> {
  override state = { failed: false, tree: this.props.tree }
  static getDerivedStateFromProps(props: { tree: unknown }, state: { tree: unknown }) {
    return props.tree === state.tree ? null : { failed: false, tree: props.tree }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface ModSiteProps {
  component: ModRenderComponent
  instanceId: string
  /** The site's props as SuperOne holds them (what the CLI's site rule expects). */
  props: Record<string, unknown>
  layout?: ModSiteLayout
  /** SuperOne's own drawing of the site; also what an `engine` node draws. */
  children?: (props: Record<string, unknown>) => ReactNode
  /**
   * The site holds live state SuperOne cannot draw twice (a decision prompt):
   * a tree without exactly one `engine` node draws SuperOne's own instead.
   */
  engineOnce?: boolean
}

/**
 * A render site a mod may redraw. Draws SuperOne's own component until (and
 * unless) a plugin drew something: an `engine` node in the plugin's tree is
 * SuperOne's component again, with the plugin's props for the first one.
 */
export function ModSite({ component, instanceId, props, layout, children, engineOnce }: ModSiteProps) {
  const ctx = useModUi()
  const snapshot = useModSite(component, instanceId, props, layout)
  const slot = useEngineSlot(engineOnce === true && !!children)
  const result = snapshot.result
  const drawn = !!ctx && snapshot.status === 'ready' && !!result && isDrawableModTree(result.tree) && (!engineOnce || countEngineRefs(result.tree) === 1)
  const firstRef = drawn ? firstEngineRef(result.tree) : 0
  // The slot's one engine node draws the plugin's props when it is a non-zero ref.
  const slotted = slot && children ? createPortal(children(!drawn ? props : firstRef !== 0 ? result.props : snapshot.props), slot) : null
  const own = slot ? <EngineSlot slot={slot} /> : children ? children(props) : null
  // The portal follows the slot's host, so the host is in the document when the component's own effects run.
  if (!drawn) return <>{own}{slotted}</>
  const env: ModTreeEnv = {
    client: ctx.client,
    component,
    instanceId,
    ports: ctx.ports,
    renderEngine: slot ? () => <EngineSlot slot={slot} /> : children,
    rewrittenProps: result.props,
    requestProps: snapshot.props,
    firstRef,
    clientModules: result.clientModules,
  }
  // Clipped and positioned: a mod's absolute boxes and negative margins stay inside its own site.
  return (
    <>
      <div className="relative min-w-0" style={SITE_CLIP}>
        <TreeBoundary tree={result.tree} fallback={own}>
          <ModTree tree={result.tree} env={env} />
        </TreeBoundary>
      </div>
      {slotted}
    </>
  )
}

// `textOverflow: inherit`: a host that truncates (SessionMode) keeps its ellipsis on the clipped line.
const SITE_CLIP: CSSProperties = { overflow: 'clip', overflowClipMargin: '4px', textOverflow: 'inherit' }

/** Where focus sat in a slot when its host unmounted, to put back in the next host. */
const slotFocus = new WeakMap<HTMLElement, HTMLElement>()

/**
 * The DOM node an `engineOnce` site's own component is portaled into for the
 * site's whole life. Only the node moves (between SuperOne's position, the
 * tree's engine node and a failed tree's fallback), so live state such as a
 * typed answer survives the first drawing, a refused redraw or mods turning off.
 */
function useEngineSlot(enabled: boolean): HTMLElement | null {
  const [slot] = useState(() => {
    // Server rendering has no portals; it draws in place.
    if (!enabled || typeof document === 'undefined') return null
    const el = document.createElement('div')
    el.style.display = 'contents'
    return el
  })
  return slot
}

function EngineSlot({ slot }: { slot: HTMLElement }) {
  const hostRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    hostRef.current!.appendChild(slot)
    const focused = slotFocus.get(slot)
    slotFocus.delete(slot)
    if (focused && slot.contains(focused)) focused.focus({ preventScroll: true })
    return () => {
      const active = slot.ownerDocument.activeElement
      if (active instanceof HTMLElement && slot.contains(active)) slotFocus.set(slot, active)
    }
  }, [slot])
  return <div ref={hostRef} style={{ display: 'contents' }} />
}

export interface ModSurfaceFrameProps {
  component: ModScrollComponent
  instanceId: string
  /** Site props besides the ones the frame measures (`bodyColumns`, `scroll`, `isFocused`). */
  props: Record<string, unknown>
  /** The plugin that owns a pane, so keyed boxes can be reported for `$.ui.scroll`. */
  plugin?: string
  /** Escape inside the frame (return the keyboard, or close a `closeOnEscape` pane). */
  onEscape?: () => void
  /** Called with whether the frame drew anything, so a band can collapse. */
  onDrawn?: (drawn: boolean) => void
  /** Viewport of the whole surface, sent with each ask. */
  viewport?: ModSiteLayout['viewport']
  className?: string
  style?: CSSProperties
  /** Asks the frame to take keyboard focus once (a pane opened with `focus`). */
  focusOnMount?: boolean
}

/**
 * The body of a pane or the band: measures the box it draws into in cells,
 * keeps scroll and focus in step with the CLI, and walks its controls with
 * the keyboard the way the terminal does (Tab / arrows, a Button's hotkey,
 * Escape back to the composer).
 */
export function ModSurfaceFrame({ component, instanceId, props, plugin, onEscape, onDrawn, viewport, className, style, focusOnMount }: ModSurfaceFrameProps) {
  const ctx = useModUi()
  const frameRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ columns: 0, bodyRows: 0 })
  const [offset, setOffset] = useState(0)
  const [focused, setFocused] = useState(false)
  const [measured, setMeasured] = useState<{ contentRows: number; keyed: ModKeyedRow[] }>({ contentRows: 0, keyed: [] })
  const followEnd = useRef(false)
  const cell = typeof document === 'undefined' ? { width: 7.2, height: 18 } : measureCell()

  useLayoutEffect(() => {
    const el = frameRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // The content box: `clientWidth` includes the frame's padding, which a mod cannot draw into.
    const measure = () => {
      const s = getComputedStyle(el)
      const width = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)
      const height = el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)
      setBox({ columns: Math.max(1, Math.floor(width / cell.width)), bodyRows: Math.max(1, Math.floor(height / cell.height)) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cell.width, cell.height])

  const siteProps = useMemo(
    () => ({ ...props, bodyColumns: box.columns, scroll: { offset, bodyRows: box.bodyRows }, ...(component === 'Pane' ? { isFocused: focused } : {}) }),
    [props, box.columns, box.bodyRows, offset, focused, component],
  )
  const layout = useMemo(() => ({ viewport, contentRows: measured.contentRows, keyed: measured.keyed }), [viewport, measured])
  const snapshot = useModSite(component, instanceId, siteProps, layout)
  const drawn = snapshot.status === 'ready'
  useEffect(() => onDrawn?.(drawn), [drawn, onDrawn])

  // After each drawing: report how tall it is and where keyed elements sit.
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || !drawn) return
    const top = content.getBoundingClientRect().top
    const keyed: ModKeyedRow[] = []
    content.querySelectorAll<HTMLElement>('[data-mod-key]').forEach((el) => {
      const owner = el.dataset.modPlugin ?? plugin
      if (!owner || keyed.length >= 512) return
      const rect = el.getBoundingClientRect()
      keyed.push({ plugin: owner, key: el.dataset.modKey!, top: Math.floor((rect.top - top) / cell.height), bottom: Math.ceil((rect.bottom - top) / cell.height) })
    })
    const contentRows = Math.ceil(content.scrollHeight / cell.height)
    setMeasured((prev) => (prev.contentRows === contentRows && JSON.stringify(prev.keyed) === JSON.stringify(keyed) ? prev : { contentRows, keyed }))
    if (followEnd.current && frameRef.current) frameRef.current.scrollTop = frameRef.current.scrollHeight
  }, [snapshot, drawn, plugin, cell.height])

  // A plugin's own scroll / focus moves for this client.
  useEffect(() => {
    if (!ctx) return
    return ctx.client.onSiteSignal(component, instanceId, (signal) => {
      const frame = frameRef.current
      if (!frame) return
      if (signal.type === 'scroll') {
        followEnd.current = signal.followEnd === true
        frame.scrollTop = signal.offset * cell.height
        setOffset(signal.offset)
      } else {
        frame.querySelector<HTMLElement>(`[data-mod-control][data-mod-plugin="${CSS.escape(signal.plugin)}"][data-mod-key="${CSS.escape(signal.key)}"]`)?.focus()
      }
    })
  }, [ctx, component, instanceId, cell.height])

  useEffect(() => {
    if (focusOnMount && drawn) frameRef.current?.querySelector<HTMLElement>('[data-mod-control]')?.focus()
  }, [focusOnMount, drawn])

  const scrollReport = useRef<{ pending: boolean; by: number }>({ pending: false, by: 0 })
  const onScroll = () => {
    const frame = frameRef.current
    if (!frame || !ctx) return
    const next = Math.round(frame.scrollTop / cell.height)
    if (next === offset) return
    scrollReport.current.by += next - offset
    setOffset(next)
    followEnd.current = frame.scrollTop + frame.clientHeight >= frame.scrollHeight - 2
    if (scrollReport.current.pending) return
    scrollReport.current.pending = true
    requestAnimationFrame(() => {
      const by = scrollReport.current.by
      scrollReport.current = { pending: false, by: 0 }
      void ctx.client.act('scroll', {
        component, instanceId, offset: next, by, bodyRows: box.bodyRows, contentRows: measured.contentRows, keyed: measured.keyed,
        surface: ctx.client.surface, clientId: ctx.client.clientId,
      })
    })
  }

  const reportFocus = (isHeld: boolean, target: HTMLElement | null) => {
    if (!ctx) return
    const key = target?.dataset.modKey
    const owner = target?.dataset.modPlugin
    void ctx.client.act('focus', {
      component, instanceId, isHeld, ...(isHeld && key && owner ? { element: { plugin: owner, key } } : {}), by: 'person',
      surface: ctx.client.surface, clientId: ctx.client.clientId,
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onEscape?.()
      return
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const frame = frameRef.current
    if (!frame) return
    const controls = [...frame.querySelectorAll<HTMLElement>('[data-mod-control]:not([disabled])')]
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && frame.scrollHeight <= frame.clientHeight + 1 && controls.length > 0) {
      e.preventDefault()
      const at = controls.indexOf(target)
      const next = e.key === 'ArrowDown' ? Math.min(controls.length - 1, at + 1) : Math.max(0, at - 1)
      controls[next]?.focus()
      return
    }
    if (!typing && /^[0-9a-z]$/.test(e.key)) {
      // The later of two buttons on one hotkey wins, as in the terminal.
      const button = controls.filter((c) => c.dataset.modHotkey === e.key).at(-1)
      if (button) {
        e.preventDefault()
        pressModHotkey(button)
      }
    }
  }

  if (!ctx) return null
  const fontStyle: CSSProperties = { ...MOD_PALETTE_STYLE, ['--mod-row' as string]: `${cell.height}px`, ...style }
  return (
    <div
      ref={frameRef}
      data-mod-site={component}
      className={`relative min-h-0 overflow-y-auto font-mono text-xs leading-[1.5] text-foreground outline-none focus-visible:shadow-none ${className ?? ''}`}
      style={fontStyle}
      tabIndex={-1}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        setFocused(true)
        reportFocus(true, (e.target as HTMLElement).closest<HTMLElement>('[data-mod-control]'))
      }}
      onBlur={(e) => {
        if (frameRef.current?.contains(e.relatedTarget as Node | null)) return
        setFocused(false)
        reportFocus(false, null)
      }}
    >
      <div ref={contentRef} className="flex min-w-0 flex-col">
        {drawn && snapshot.result && isDrawableModTree(snapshot.result.tree) ? (
          <TreeBoundary tree={snapshot.result.tree} fallback={null}>
            <ModTree
              tree={snapshot.result.tree}
              env={{ client: ctx.client, component, instanceId, ports: ctx.ports, rewrittenProps: snapshot.result.props, requestProps: snapshot.props, firstRef: firstEngineRef(snapshot.result.tree), clientModules: snapshot.result.clientModules }}
            />
          </TreeBoundary>
        ) : null}
      </div>
    </div>
  )
}

const EMPTY_PROPS: Record<string, unknown> = {}
const EMPTY_PORTS: ModUiPorts = {}

export interface ModBackdropSnapshot {
  result: ModRenderResult
  props: Record<string, unknown>
}

export interface ModThemeStyleOptions {
  fallback?: Record<string, unknown> | null
  onThemeChange?: (props: Record<string, unknown> | null) => void
}

/** Session-scoped CSS variable overrides from the active Claude mod theme. */
export function useModThemeStyle(scheme: 'light' | 'dark', options?: ModThemeStyleOptions): CSSProperties {
  const ctx = useModUi()
  const snapshot = useModSite('Theme', MOD_THEME_INSTANCE, EMPTY_PROPS)
  const liveReady = !!ctx?.client.isAvailable && snapshot.status === 'ready' && !!snapshot.result
  const liveOff = !!ctx?.client.isAvailable && snapshot.status === 'off'
  const liveProps = liveReady && snapshot.result ? snapshot.result.props : null
  const onThemeChange = options?.onThemeChange

  useEffect(() => {
    if (!onThemeChange) return
    if (liveReady) onThemeChange(liveProps)
    else if (liveOff) onThemeChange(null)
  }, [liveReady, liveOff, liveProps, onThemeChange])

  const effectiveProps = liveProps ?? (!ctx?.client.isAvailable && options?.fallback ? options.fallback : EMPTY_PROPS)
  return useMemo(() => parseModThemeStyle(effectiveProps, scheme), [effectiveProps, scheme])
}

/**
 * Full-surface backdrop drawn behind the conversation when a mod sets one,
 * with an optional frosted-glass layer above it to keep text legible.
 */
export function ModBackdropLayer({
  viewport,
  className,
  glassEnabled = true,
  fallback,
  onBackdropChange,
}: {
  viewport?: ModSiteLayout['viewport']
  className?: string
  glassEnabled?: boolean
  fallback?: ModBackdropSnapshot | null
  onBackdropChange?: (active: ModBackdropSnapshot | null) => void
}) {
  const ctx = useModUi()
  const layerRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ columns: 80, bodyRows: 24 })
  const cell = typeof document === 'undefined' ? { width: 7.2, height: 18 } : measureCell()

  useLayoutEffect(() => {
    const el = layerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      setBox({
        columns: Math.max(1, Math.floor(el.clientWidth / cell.width)),
        bodyRows: Math.max(1, Math.floor(el.clientHeight / cell.height)),
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cell.width, cell.height])

  const siteProps = useMemo(
    () => ({ bodyColumns: box.columns, scroll: { offset: 0, bodyRows: box.bodyRows } }),
    [box.columns, box.bodyRows],
  )
  const layout = useMemo(() => ({ viewport }), [viewport])
  const snapshot = useModSite('Backdrop', MOD_BACKDROP_INSTANCE, siteProps, layout)
  const liveAvailable = !!ctx?.client.isAvailable
  const liveTree = snapshot.status === 'ready' ? snapshot.result?.tree : undefined
  const liveActive = liveAvailable && !!snapshot.result && !!liveTree && liveTree.type !== 'engine' && isDrawableModTree(liveTree)
  const liveOff = liveAvailable && (snapshot.status === 'off' || (snapshot.status === 'ready' && !liveActive))

  useEffect(() => {
    if (!onBackdropChange) return
    if (liveActive && snapshot.result) onBackdropChange({ result: snapshot.result, props: snapshot.props })
    else if (liveOff) onBackdropChange(null)
  }, [liveActive, liveOff, snapshot.result, snapshot.props, onBackdropChange])

  const effective = liveActive && snapshot.result
    ? { result: snapshot.result, props: snapshot.props }
    : !liveAvailable && fallback
      ? fallback
      : null
  const active = !!effective && effective.result.tree.type !== 'engine' && isDrawableModTree(effective.result.tree)
  const backdropProps = useMemo(
    () => (active && effective ? parseModBackdropProps(effective.result.props) : null),
    [active, effective],
  )
  const glassStyle = useMemo(
    () => (backdropProps ? modBackdropGlassStyle(backdropProps.glass) : undefined),
    [backdropProps],
  )

  if (!ctx && !fallback) return null
  return (
    <div
      ref={layerRef}
      data-mod-site="Backdrop"
      data-mod-backdrop={active ? 'true' : undefined}
      data-mod-color-scheme={backdropProps?.colorScheme}
      aria-hidden="true"
      className={`pointer-events-none select-none overflow-hidden ${className ?? 'absolute inset-0 z-0'}`}
      style={{ ...MOD_PALETTE_STYLE, ['--mod-row' as string]: `${cell.height}px` }}
    >
      {active && effective ? (
        <>
          <div className="h-full w-full">
            <TreeBoundary tree={effective.result.tree} fallback={null}>
              <ModTree
                tree={effective.result.tree}
                env={{
                  client: ctx?.client as ModUiClient,
                  component: 'Backdrop',
                  instanceId: MOD_BACKDROP_INSTANCE,
                  ports: ctx?.ports ?? EMPTY_PORTS,
                  rewrittenProps: effective.result.props,
                  requestProps: effective.props,
                  firstRef: firstEngineRef(effective.result.tree),
                  clientModules: effective.result.clientModules,
                }}
              />
            </TreeBoundary>
          </div>
          {glassEnabled && glassStyle ? <div className="absolute inset-0" style={glassStyle} /> : null}
        </>
      ) : null}
    </div>
  )
}

function ModPlacedRowSite({ row }: { row: ModPlacedRow }) {
  const props = useMemo(() => ({ plugin: row.plugin, id: row.id }), [row.plugin, row.id])
  return (
    <div data-mod-placed-id={row.id} data-mod-plugin={row.plugin} className="my-2">
      <ModSite component="Placed" instanceId={row.requestId} props={props} />
    </div>
  )
}

/** Renders placed mod cards (`$.ui.place`), returning null when empty. */
export function ModPlacedRows({ rows }: { rows: readonly ModPlacedRow[] }) {
  if (rows.length === 0) return null
  return (
    <>
      {rows.map((row) => (
        <ModPlacedRowSite key={row.requestId} row={row} />
      ))}
    </>
  )
}

export function partitionPlacedRows(
  placed: readonly ModPlacedRow[],
  messageIds: ReadonlySet<string>,
): { start: ModPlacedRow[]; after: Map<string, ModPlacedRow[]>; tail: ModPlacedRow[] } {
  const start: ModPlacedRow[] = []
  const after = new Map<string, ModPlacedRow[]>()
  const tail: ModPlacedRow[] = []
  for (const row of placed) {
    if (!row.afterUuid) {
      start.push(row)
    } else if (messageIds.has(row.afterUuid)) {
      const list = after.get(row.afterUuid)
      if (list) list.push(row)
      else after.set(row.afterUuid, [row])
    } else {
      tail.push(row)
    }
  }
  return { start, after, tail }
}
