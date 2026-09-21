/** Touch-device adapter over the existing session executor and current-state store. */
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { DEVICE_PROVIDER_PLATFORM, parseDeviceId, type DevicePlatform } from '@superone/shared/device'
import { evaluateCondition, type DeviceCondition } from '../device-agent/conditions'
import type { DeviceAgentSession } from '../device-agent/execute'
import type { DeviceState } from '../device-agent/state-store'
import { RunPaused, StaleObservation, type RunDeps } from './loop'
import type { RunWords } from './questions'
import { SETTLED_ADAPTER_POLL_MS, waitForChangeByPolling, waitReadyByPolling } from './settle'
import type { RawElement, RunObservation } from './observation'

export interface DevicePage extends RunObservation {
  stateId: string
  state: DeviceState
  signature: string
  refs: Map<number, DeviceUiNode>
  outcome?: 'worked' | 'didnt' | 'unknown'
  scrollRef?: string
}

/**
 * A phone has no Escape key and no right button. What it has instead: the
 * system Back button (Android) or the edge swipe back (iOS), and the long
 * press that opens an item's menu on both.
 */
export const DEVICE_WORDS: RunWords = {
  escape: { label: 'Go back', target: 'Back', action: 'Go back: leave this screen for the one before it, or dismiss the open sheet, menu or keyboard, without saving anything.' },
  contextMenu: { verb: 'Long-press', action: 'Long-press an offered item to open its context menu or actions; the commands are chosen in the next step.' },
}

const ROLES: Record<string, string> = {
  textfield: 'textbox', textview: 'textbox', textentry: 'textbox', textarea: 'textbox',
  edittext: 'textbox', searchfield: 'searchbox', searchtext: 'searchbox', searchtextfield: 'searchbox',
  togglebutton: 'switch', radiobutton: 'radio', tabbutton: 'tab',
}
const CLICK_ROLES = new Set(['button', 'link', 'cell', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'treeitem'])
/** Containers that scroll on their own: a swipe inside moves their content, not the screen. */
const SCROLL_ROLES = new Set(['scrollview', 'scrollarea', 'list', 'table', 'collectionview', 'collection', 'grid', 'pager'])
/** Content items a long press opens a menu on; buttons count only when they are rows of a list. */
const ITEM_ROLES = new Set(['cell', 'link', 'image', 'treeitem', 'option'])
const PICTURE_ROLES = new Set(['image', 'imageview', 'map', 'mapview'])
const OVERLAY_ROLES = new Set(['alert', 'sheet', 'dialog', 'popover', 'actionsheet'])
const TITLE_ROLES = new Set(['navigationbar', 'toolbar'])
const TEXT_ROLES = new Set(['text', 'statictext', 'heading', 'label'])
/** iOS reports a switch as a checkbox valued "1"/"0"; Android as checked/unchecked. */
const ON = new Set(['1', 'true', 'checked', 'on']), OFF = new Set(['0', 'false', 'unchecked', 'off'])
const MAX_ELEMENTS = 250
const MAX_TEXT = 4000
const MAX_PICTURES = 12
const MAX_FIELDS = 6

export function devicePlatform(deviceId: string): DevicePlatform {
  const provider = parseDeviceId(deviceId)?.provider
  return provider ? DEVICE_PROVIDER_PLATFORM[provider] : 'ios'
}

function roleOf(node: DeviceUiNode): string {
  const raw = node.role.replace(/^AX|^XCUIElementType/, '').split('.').pop()!.toLowerCase()
  return ROLES[raw] ?? raw
}

function rect(bounds: DeviceUiNode['bounds']): RawElement['bounds'] | undefined {
  return bounds ? { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3] } : undefined
}

function idTail(node: DeviceUiNode): string | undefined {
  const tail = node.identifier?.split(/[/:.]/).pop()?.replace(/_/g, ' ').trim()
  return tail || undefined
}

/** The first labelled text descendants, depth-first: what a person calls a row whose button has no name of its own. */
function textsBelow(node: DeviceUiNode, out: DeviceUiNode[] = []): DeviceUiNode[] {
  for (const child of node.children ?? []) {
    if (out.length >= 3) break
    if (child.source === 'ocr' || child.secure) continue
    if (TEXT_ROLES.has(roleOf(child)) && child.label) out.push(child)
    else textsBelow(child, out)
  }
  return out
}

function isSwitch(role: string, value: string | undefined): value is string {
  return (role === 'checkbox' || role === 'switch' || role === 'toggle' || role === 'radio') && value != null && (ON.has(value.toLowerCase()) || OFF.has(value.toLowerCase()))
}

function clickableRole(node: DeviceUiNode): boolean {
  return CLICK_ROLES.has(roleOf(node))
}

/**
 * A list on iOS is a plain `group` to the accessibility bridge: nothing says
 * it scrolls. Three or more rows filling half the screen is one.
 */
function implicitList(node: DeviceUiNode, role: string): boolean {
  if (role !== 'group' || !node.bounds || !node.children) return false
  const rows = node.children.filter((c) => clickableRole(c) && c.bounds)
  if (rows.length < 3) return false
  const top = Math.min(...rows.map((r) => r.bounds![1]))
  const bottom = Math.max(...rows.map((r) => r.bounds![1] + r.bounds![3]))
  return bottom - top >= 0.5
}

function scrollable(node: DeviceUiNode, role: string): boolean {
  return SCROLL_ROLES.has(role) || implicitList(node, role)
}

function containsScrollable(node: DeviceUiNode): boolean {
  return (node.children ?? []).some((c) => scrollable(c, roleOf(c)) || containsScrollable(c))
}

/**
 * Where a scroll area can still move, from the rows that stick out of it. A
 * tree lists only what is on screen, so no evidence means both ways are
 * offered rather than none: a swipe on a list that fits does nothing.
 */
function scrollRoom(node: DeviceUiNode): { up: boolean; down: boolean } {
  const [, top, , height] = node.bounds ?? [0, 0, 1, 1]
  const bottom = top + height
  let above = false, below = false
  const visit = (n: DeviceUiNode) => {
    for (const c of n.children ?? []) {
      if (c.bounds) {
        if (c.bounds[1] < top - 0.005) above = true
        if (c.bounds[1] + c.bounds[3] > bottom + 0.005) below = true
      }
      visit(c)
    }
  }
  visit(node)
  return above || below ? { up: above, down: below } : { up: true, down: true }
}

export function devicePage(state: DeviceState, deviceId: string): DevicePage {
  const observation = state.observation
  const elements: RawElement[] = []
  const refs = new Map<number, DeviceUiNode>()
  const text: string[] = []
  const fields: string[] = []
  const pictures: string[] = []
  const overlays: string[] = []
  /** Text nodes whose words became a control's label: not repeated as lines of their own. */
  const consumed = new Set<string>()
  let scrollRef: string | undefined
  let app: string | undefined
  let title: string | undefined
  let keyboard = false

  const add = (node: DeviceUiNode, el: Omit<RawElement, 'node' | 'ref' | 'bounds'>): void => {
    if (elements.length >= MAX_ELEMENTS) return
    const id = elements.length + 1
    refs.set(id, node)
    const bounds = rect(node.bounds)
    elements.push({ node: id, ref: node.ref, ...el, ...(bounds ? { bounds } : {}) })
  }

  const walk = (node: DeviceUiNode, scrollArea: DeviceUiNode | undefined, insideControl: string | undefined) => {
    const role = roleOf(node)
    const secure = node.secure === true || /secure|password/.test(node.role.toLowerCase())
    // OCR boxes do not prove a clickable control and are outside this loop's contract.
    const semantic = node.source !== 'ocr'
    const bounds = node.bounds
    const visible = !!bounds && bounds[2] > 0 && bounds[3] > 0 && bounds[0] < 1 && bounds[1] < 1 && bounds[0] + bounds[2] > 0 && bounds[1] + bounds[3] > 0
    const enabled = semantic && node.enabled !== false && !secure && visible
    const disabled = semantic && node.enabled === false

    if (role === 'application' && node.label) app ??= node.label
    if (OVERLAY_ROLES.has(role)) overlays.push(`${role === 'alert' ? 'an' : 'a'} ${role}${node.label ? ` "${node.label}"` : ''}`)
    else if (node.identifier === 'android:id/alertTitle' && node.label) overlays.push(`a dialog "${node.label}"`)
    if (role === 'keyboard') keyboard = true
    if (title === undefined) {
      // The bar's own name, or the large/inline title heading at the top. A
      // navigation bar the bridge names only by identifier (Text Replacement)
      // still carries the title there, as long as it is a word, not an id.
      if (node.label && (TITLE_ROLES.has(role) || /toolbar|action_bar|app_bar/.test(node.identifier ?? ''))) title = node.label
      else if (role === 'group' && bounds && bounds[1] < 0.1 && bounds[3] < 0.1 && bounds[2] > 0.9 && node.identifier && !/[:/.]/.test(node.identifier)) title = node.identifier
      else if (role === 'heading' && node.label && node.label.length > 1 && bounds && bounds[1] < 0.15) title = node.label
    }

    const editable = enabled && ['textbox', 'searchbox', 'combobox'].includes(role)
    // A picture standing on its own (a photo in the grid, a map) is content
    // on a phone: tapped to open, long-pressed for its menu — and still the
    // place a handed-over point or path would land (§11.4).
    const picture = semantic && insideControl === undefined && PICTURE_ROLES.has(role) && visible && bounds![2] >= 0.1 && bounds![3] >= 0.05
    const clickable = enabled && (editable || CLICK_ROLES.has(role) || picture)
    // An Android row is a nameless button whose words are the texts inside
    // it; the nameless switch inside that row is called what the row is.
    let label = node.label ?? ''
    let value = node.value ?? ''
    if (clickable && !label) {
      const below = textsBelow(node)
      if (below.length) {
        label = below[0].label!
        value = value || below.slice(1).map((t) => t.label).join(', ').slice(0, 80)
        for (const t of below) consumed.add(t.ref)
      } else label = insideControl || idTail(node) || ''
    }
    const toggled = isSwitch(role, value) ? (ON.has(value.toLowerCase()) ? 'true' : 'false') : undefined
    if (toggled) value = toggled === 'true' ? 'on' : 'off'

    if (!secure && semantic && role !== 'application' && !consumed.has(node.ref)) {
      const line = [label, toggled ? `: ${value}` : value ? ` ${value}` : ''].join('')
      if (line) text.push(disabled ? `${line} (disabled)` : line)
    }

    // Each scroll area with nothing scrollable inside it is its own candidate,
    // so the `scroll_area` head can aim at the list rather than the page that
    // holds it. The first one found stays the default for an unnamed scroll.
    let area = scrollArea
    if (enabled && scrollable(node, role)) {
      // What is inside a scroll container is a list item wherever the
      // container sits; only the innermost one is offered as a place to swipe.
      area = node
      if (!containsScrollable(node)) {
        scrollRef ??= node.ref
        add(node, { role: 'scrollarea', label: label || idTail(node) || textsBelow(node)[0]?.label || 'list', value: '', scroll: scrollRoom(node),
          editable: false, clickable: false, canSubmit: false, password: false, submit: false, disabled: false })
      }
    }

    if (clickable) {
      if (editable && fields.length < MAX_FIELDS) fields.push(`(text field "${label.slice(0, 40)}": ${node.focused ? 'focused, ' : ''}${value ? `holds "${value.slice(0, 80)}"` : 'empty'})`)
      const item = ITEM_ROLES.has(role) || (role === 'button' && !!scrollArea)
      if (picture) { label ||= 'Picture'; if (pictures.length < MAX_PICTURES) pictures.push(`(picture-only: ${label})`) }
      add(node, { role: picture ? 'image' : role, label, value, ...(toggled ? { checked: toggled } : {}), ...(item ? { contextMenu: true } : {}), ...(picture ? { picture: true } : {}),
        editable, clickable, canSubmit: false, password: false, submit: false, disabled: false })
    }

    if (!secure) for (const child of node.children ?? []) walk(child, area, clickable ? label : insideControl)
  }
  walk(observation.root, undefined, undefined)

  const scrolls = elements.filter((e) => e.scroll)
  const unavailable = observation.treeUnavailable || (elements.length === 0 && text.every((s) => !s))
  const observing = `(observing: ${app ? `${app} ` : ''}screen${title ? ` "${title}"` : ''}; ${overlays.length ? `${overlays.join(' and ')} open` : 'no alert or sheet open'}${keyboard ? '; keyboard shown' : ''})`
  return {
    stateId: state.stateId, state, refs, scrollRef,
    url: '', title: title ?? deviceId, target: { device: deviceId }, elements,
    text: [observing, ...fields, ...pictures, ...text.filter(Boolean)].join('\n').slice(0, MAX_TEXT),
    omitted: observation.truncated ? 1 : 0, loading: !observation.settled,
    scroll: { y: 0, height: 0, viewport: 0 },
    // A screen with no list or scroll area on it has nowhere to swipe; a
    // swipe on a form that fits is a gesture on whatever sits under it.
    canScroll: { down: scrolls.some((s) => s.scroll!.down), up: scrolls.some((s) => s.scroll!.up) },
    canEscape: true,
    signature: JSON.stringify(observation.root),
    ...(unavailable ? { blocked: { reason: 'no-progress' as const, why: 'No usable accessibility tree is available. Use device_snapshot mode=visual and take over with device_act.' } } : {}),
  }
}

export interface DeviceAdapterOptions {
  deviceId: string
  session: DeviceAgentSession
  ask: RunDeps['ask']
  doneWhen?: DeviceCondition
  /** Fail with the existing NO_DEVICE error if ownership changed. Never asks for control. */
  assertControl(): void
}

export function createDeviceAdapter(options: DeviceAdapterOptions): RunDeps<DevicePage> {
  const { session } = options
  const platform = devicePlatform(options.deviceId)
  let current: DevicePage | undefined
  let successor: DevicePage | undefined
  const requirePage = () => {
    if (!current) throw new RunPaused('no-progress', 'The device has not been observed.')
    return current
  }
  /**
   * A live read, bypassing the pending successor: waiting has to watch the
   * screen move, and replaying the state the action already produced would
   * report a change on its first sample every time.
   */
  const observeFresh = async (signal?: AbortSignal) => {
    options.assertControl()
    signal?.throwIfAborted()
    return devicePage(await session.observeForRun(signal), options.deviceId)
  }
  const act = async (actions: Array<Record<string, unknown>>, signal?: AbortSignal) => {
    options.assertControl()
    const page = requirePage()
    if (session.store.latest?.stateId !== page.stateId) throw new StaleObservation('The device snapshot has been superseded.')
    signal?.throwIfAborted()
    const result = await session.act({ stateId: page.stateId, actions }, signal)
    signal?.throwIfAborted()
    const value = JSON.parse(result.content[0].text) as Record<string, unknown>
    if (result.isError) {
      if (value.error === 'STALE_STATE') throw new StaleObservation(String(value.message))
      throw new RunPaused('no-progress', String(value.message ?? value.error ?? 'Device input was refused.'))
    }
    const state = session.store.latest
    if (!state || state.stateId !== value.stateId) throw new RunPaused('no-progress', 'The action completed but its successor snapshot is unavailable. Inspect before retrying.')
    successor = { ...devicePage(state, options.deviceId), outcome: value.outcome as DevicePage['outcome'] }
    if (value.failure) throw new RunPaused('no-progress', `Device input failed: ${String(value.failure)}. Inspect before retrying.`)
  }
  const swipe = (ref: string | undefined, deltaY: number) => ({ type: 'swipe', ...(ref ? { ref } : {}), direction: deltaY > 0 ? 'up' : 'down', distance: 0.55 })
  return {
    platform: 'device', words: DEVICE_WORDS, ask: options.ask, reobserveOnResume: true,
    resolveTarget: async () => { options.assertControl(); successor = undefined },
    observe: async (signal) => {
      options.assertControl()
      signal?.throwIfAborted()
      if (successor && session.store.latest?.stateId === successor.stateId) { current = successor; successor = undefined; return current }
      current = devicePage(await session.observeForRun(signal), options.deviceId)
      return current
    },
    // A fused device_snapshot for a pause: path, size and the screen the
    // coordinates are ratios of. It becomes the latest state, which is fine —
    // a resume re-observes before it acts.
    capture: async (signal) => {
      options.assertControl()
      const reply = await session.snapshot({ mode: 'fused' }, signal)
      const value = JSON.parse(reply.content[0].text) as { stateId?: string; image?: { path: string; width: number; height: number }; screen?: { width: number; height: number } }
      if (reply.isError || !value.image?.path) return null
      return { stateId: value.stateId, image: value.image, ...(value.screen ? { coordinateSpace: value.screen } : {}) }
    },
    isFresh: async (page) => session.store.latest?.stateId === page.stateId,
    sameTarget: (before, after, element) => before.signature === after.signature
      && after.elements.some((e) => e.node === element.node && e.label === element.label && e.editable === element.editable),
    sameActionState: (before, after) => before.signature === after.signature
      && before.state.observation.orientation === after.state.observation.orientation
      && JSON.stringify(before.state.observation.screen) === JSON.stringify(after.state.observation.screen),
    /** Actions handed over at a capability pause, in `device_act`'s vocabulary; the same gate as a device_act call. */
    act: (_page, actions, signal) => act(actions as Array<Record<string, unknown>>, signal),
    /**
     * iOS presses through accessibility: a switch's row is one element whose
     * centre is its label, where a tap toggles nothing (run rb524a586 tapped
     * Haptic Feedback three times). Android refuses `press` and takes the tap.
     */
    click: (id, signal) => {
      const node = requirePage().refs.get(id)!
      return act([{ type: platform === 'android' || PICTURE_ROLES.has(roleOf(node)) ? 'tap' : 'press', ref: node.ref }], signal)
    },
    type: (id, text, signal) => act([
      { type: 'tap', ref: requirePage().refs.get(id)!.ref }, { type: 'setText', text },
    ], signal),
    pressEnter: async () => { throw new RunPaused('no-progress', 'Device keyboard submit is not offered. Select a visible submit control with device_act.') },
    scroll: (page, deltaY, signal) => act([swipe(page.scrollRef, deltaY)], signal),
    scrollArea: (id, deltaY, signal) => act([swipe(requirePage().refs.get(id)!.ref, deltaY)], signal),
    /** Long-press the item: its context menu or actions are what the next observation shows. */
    contextMenu: (id, signal) => act([{ type: 'longPress', ref: requirePage().refs.get(id)!.ref }], signal),
    /**
     * Back, the way the platform does it: Android's system button; on iOS
     * the edge swipe that pops a navigation stack, which has no button to
     * press when the bar's back control is not in the tree.
     */
    dismiss: (signal) => act([platform === 'android'
      ? { type: 'key', button: 'back' }
      : { type: 'swipe', x: 0.005, y: 0.5, toX: 0.7, toY: 0.5, durationMs: 400 }], signal),
    /**
     * Nothing to add: the backend settles on pixels inside every observation —
     * both the one `act` takes for its successor and the one `observe` takes —
     * so a page handed to the loop has already stopped moving, or has told us
     * it has not via `loading`.
     */
    settle: async () => {},
    waitReady: (timeoutMs, signal) => waitReadyByPolling(timeoutMs, observeFresh, signal, { pollMs: SETTLED_ADAPTER_POLL_MS }),
    /**
     * The loop's fallback decides with `changed`, which here reports the last
     * action's verdict rather than comparing two observations — so it could
     * never see a screen settle and every wait burned its whole cap.
     */
    waitForChange: (page, timeoutMs, signal) => waitForChangeByPolling(page, timeoutMs, observeFresh, signal, { pollMs: SETTLED_ADAPTER_POLL_MS }),
    checkDone: async () => {
      options.assertControl()
      const page = requirePage()
      return !!options.doneWhen && !page.state.observation.treeUnavailable && page.state.observation.settled
        && evaluateCondition(page.state.observation.root, options.doneWhen)
    },
    changed: (_before, after) => after.outcome === 'worked' ? true : after.outcome === 'didnt' ? false : null,
    focusGuard: async () => {},
  }
}
