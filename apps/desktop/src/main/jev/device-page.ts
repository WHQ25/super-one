/** Touch-device adapter over the existing session executor and current-state store. */
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { evaluateCondition, type DeviceCondition } from '../device-agent/conditions'
import type { DeviceAgentSession } from '../device-agent/execute'
import type { DeviceState } from '../device-agent/state-store'
import { RunPaused, StaleObservation, type RunDeps } from './loop'
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

const ROLES: Record<string, string> = {
  textfield: 'textbox', textview: 'textbox', textentry: 'textbox', textarea: 'textbox',
  edittext: 'textbox', searchfield: 'searchbox', searchtext: 'searchbox', searchtextfield: 'searchbox',
  togglebutton: 'switch', radiobutton: 'radio', tabbutton: 'tab',
}
const CLICK_ROLES = new Set(['button', 'link', 'cell', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'treeitem'])

export function devicePage(state: DeviceState, deviceId: string): DevicePage {
  const observation = state.observation
  const elements: RawElement[] = []
  const refs = new Map<number, DeviceUiNode>()
  const text: string[] = []
  let scrollRef: string | undefined
  const walk = (node: DeviceUiNode) => {
    const rawRole = node.role.replace(/^AX|^XCUIElementType/, '').split('.').pop()!.toLowerCase()
    const role = ROLES[rawRole] ?? rawRole
    const secure = node.secure === true || /secure|password/.test(rawRole)
    // OCR boxes do not prove a clickable control and are outside this loop's contract.
    const semantic = node.source !== 'ocr'
    if (!secure && semantic) text.push([node.label, node.value].filter(Boolean).join(' '))
    const bounds = node.bounds
    const visible = !!bounds && bounds[2] > 0 && bounds[3] > 0 && bounds[0] < 1 && bounds[1] < 1 && bounds[0] + bounds[2] > 0 && bounds[1] + bounds[3] > 0
    const enabled = semantic && node.enabled !== false && !secure && visible
    if (enabled && /scroll|table|list|collection/.test(role) && !scrollRef) scrollRef = node.ref
    const editable = enabled && ['textbox', 'searchbox', 'combobox'].includes(role)
    const clickable = enabled && (editable || CLICK_ROLES.has(role))
    if (elements.length < 250 && clickable) {
      const id = Number(node.ref.replace(/^@e/, ''))
      if (Number.isSafeInteger(id) && id >= 0) {
        refs.set(id, node)
        elements.push({ node: id, ref: node.ref, role, label: node.label ?? node.identifier ?? '', value: node.value ?? '',
          editable, clickable, canSubmit: false, password: false, submit: false, disabled: false })
      }
    }
    if (!secure) for (const child of node.children ?? []) walk(child)
  }
  walk(observation.root)
  const unavailable = observation.treeUnavailable || (elements.length === 0 && text.every((s) => !s))
  return {
    stateId: state.stateId, state, refs, scrollRef,
    url: '', title: deviceId, target: { device: deviceId }, text: text.filter(Boolean).join('\n').slice(0, 4000), elements,
    omitted: observation.truncated ? 1 : 0, loading: !observation.settled,
    scroll: { y: 0, height: 0, viewport: 0 }, canScroll: { down: !!scrollRef, up: !!scrollRef },
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
  return {
    platform: 'device', ask: options.ask, reobserveOnResume: true,
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
    /** Actions handed over at a capability pause, in `device_act`'s vocabulary; the same gate as a device_act call. */
    act: (_page, actions, signal) => act(actions as Array<Record<string, unknown>>, signal),
    click: (id, signal) => act([{ type: 'tap', ref: requirePage().refs.get(id)!.ref }], signal),
    type: (id, text, signal) => act([
      { type: 'tap', ref: requirePage().refs.get(id)!.ref }, { type: 'setText', text },
    ], signal),
    pressEnter: async () => { throw new RunPaused('no-progress', 'Device keyboard submit is not offered. Select a visible submit control with device_act.') },
    scroll: (page, deltaY, signal) => act([{ type: 'swipe', ref: page.scrollRef, direction: deltaY > 0 ? 'up' : 'down', distance: 0.55 }], signal),
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
