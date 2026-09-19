/** Touch-device adapter over the existing session executor and current-state store. */
import type { DeviceUiNode } from '@superone/shared/device-agent'
import { evaluateCondition, type DeviceCondition } from '../device-agent/conditions'
import type { DeviceAgentSession } from '../device-agent/execute'
import type { DeviceState } from '../device-agent/state-store'
import { RunPaused, StaleObservation, type RunDeps } from './loop'
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
    isFresh: async (page) => session.store.latest?.stateId === page.stateId,
    sameTarget: (before, after, element) => before.signature === after.signature
      && after.elements.some((e) => e.node === element.node && e.label === element.label && e.editable === element.editable),
    click: (id, signal) => act([{ type: 'tap', ref: requirePage().refs.get(id)!.ref }], signal),
    type: (id, text, signal) => act([
      { type: 'tap', ref: requirePage().refs.get(id)!.ref }, { type: 'setText', text },
    ], signal),
    pressEnter: async () => { throw new RunPaused('no-progress', 'Device keyboard submit is not offered. Select a visible submit control with device_act.') },
    scroll: (page, deltaY, signal) => act([{ type: 'swipe', ref: page.scrollRef, direction: deltaY > 0 ? 'up' : 'down', distance: 0.55 }], signal),
    settle: async () => {}, // The session executor owns focus settling and successor capture.
    waitReady: async () => true,
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
