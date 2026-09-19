/** Desktop adapter: retain the service's state/epoch and use its action evidence. */
import { type ComputerUseService } from '../computer-use/computer-use-service'
import { compactOutline, dropOccludedWebAreas } from '../computer-use/outline-compact'
import { findNode, foldOutline } from '../computer-use/outline'
import { ComputerUseError, type ActResult, type Condition, type ObserveResult, type UiOutlineNode } from '../computer-use/types'
import { planNodeAction, type NodeActionPlan } from '../computer-use/node-action-plan'
import { type RunDeps, RunPaused, StaleObservation } from './loop'
import type { RawElement, RunObservation } from './observation'
import { computerCommandRisk } from './computer-command-risk'

export interface ComputerPage extends RunObservation {
  stateId: string
  rootId: string
  bundleId: string
  refs: Map<number, UiOutlineNode>
  signature: string
  scrollRef?: string
  outcome?: ActResult
}

const ROLE_MAP: Record<string, string> = { textfield: 'textbox', textarea: 'textbox', searchfield: 'searchbox', combobox: 'combobox', radiobutton: 'radio', popupbutton: 'button', menubaritem: 'menuitem' }

export function computerPage(result: ObserveResult, service: ComputerUseService): ComputerPage {
  const tier = service.policy.tierFor(result.root.bundleId)
  const elements: RawElement[] = []
  const refs = new Map<number, UiOutlineNode>()
  const text: string[] = []
  let scrollRef: string | undefined
  const walk = (node: UiOutlineNode) => {
    const role = node.role.replace(/^AX/, '').toLowerCase()
    const secure = node.secure === true || /secure|password/.test(role)
    const value = secure ? '' : node.value ?? ''
    if (!secure) text.push([node.name, value].filter(Boolean).join(' '))
    const enabled = node.enabled !== false && !node.pictureOnly && !secure
    const editable = !!planNodeAction(node, { kind: 'setText', text: '' }, tier)
    const clickable = !!planNodeAction(node, { kind: 'press' }, tier)
    if (!scrollRef && planNodeAction(node, { kind: 'scroll', dy: 1 }, tier)) scrollRef = node.ref
    if (elements.length < 250 && enabled && (editable || clickable)) {
      const id = Number(node.ref.replace(/^@e/, ''))
      if (Number.isSafeInteger(id) && id > 0) {
        refs.set(id, node)
        const command = node.nativeTarget?.scope === 'menuBar'
        elements.push({ node: id, ref: node.ref, role: command ? 'button' : ROLE_MAP[role] ?? role, label: node.name ?? '', value,
          ...(command ? { riskHint: computerCommandRisk(node.name ?? '') } : {}),
          editable, clickable, canSubmit: !!planNodeAction(node, { kind: 'enter' }, tier), password: false, submit: false, disabled: false })
      }
    }
    if (!secure) for (const child of node.children ?? []) walk(child)
  }
  walk(result.outline)
  return {
    url: '', title: `${result.root.app} — ${result.root.title}`, text: text.filter(Boolean).join('\n').slice(0, 4000),
    elements, omitted: result.truncation.nodesOmitted, loading: false,
    scroll: { y: 0, height: 0, viewport: 0 }, canScroll: { down: !!scrollRef, up: !!scrollRef },
    stateId: result.stateId, rootId: result.root.rootId, bundleId: result.root.bundleId, refs, scrollRef,
    target: { app: result.root.app, bundleId: result.root.bundleId, root: result.root.rootId },
    signature: JSON.stringify(result.outline),
    ...(tier === 'read' ? { blocked: { reason: 'guarded-only' as const, why: 'The app grant has tier=read; computer_run needs click or full access. Use computer_apps to resolve the grant.' } } : {}),
  }
}

export interface ComputerAdapterOptions {
  service: ComputerUseService
  root?: string
  doneWhen?: Condition
  ask: RunDeps['ask']
  /** The existing identity/grant path, called only at a tool-call boundary. */
  resolve(signal?: AbortSignal): Promise<string>
}

export function createComputerAdapter(options: ComputerAdapterOptions): RunDeps<ComputerPage> {
  const { service } = options
  let root = options.root
  let bundleId: string | undefined
  let current: ComputerPage | undefined
  let successor: ComputerPage | undefined
  let conditionStateId: string | undefined
  const requirePage = () => {
    if (!current) throw new RunPaused('no-progress', 'Take a new computer snapshot before continuing.')
    return current
  }
  const fresh = (page: ComputerPage) => {
    const state = service.getStateStore().get(page.stateId)
    return !!state && state.epoch === service.getScheduler().epoch(state.resourceKey)
  }
  const act = async (plan: NodeActionPlan | undefined, signal?: AbortSignal) => {
    if (!plan) throw new RunPaused('no-progress', 'The observed target does not support this computer_act operation. Inspect a fresh snapshot before continuing.')
    const page = requirePage()
    if (!fresh(page)) throw new StaleObservation('The desktop resource changed before input.')
    signal?.throwIfAborted()
    try {
      const result = await service.act(page.stateId, plan.actions, { delivery: plan.delivery, signal, expect: plan.expect, timeoutMs: 1200 })
      const state = service.getStateStore().get(result.successorStateId)
      if (!state) throw new RunPaused('no-progress', 'The action completed but its successor state is unavailable. Inspect before retrying.')
      if (state.root.bundleId !== bundleId) throw new RunPaused('guarded-only', 'The action switched applications. Resolve the new app grant with computer_apps before continuing.')
      const folded = foldOutline(compactOutline(dropOccludedWebAreas(state.outline)))
      successor = { ...computerPage({ ...state, outline: folded.outline, truncation: folded }, service), outcome: result }
      root = state.root.rootId
    } catch (error) {
      if (error instanceof ComputerUseError) {
        if (error.code === 'STALE_STATE') throw new StaleObservation(error.message)
        if (['MODAL_BLOCKED', 'TIER_BLOCKED', 'NOT_GRANTED'].includes(error.code)) throw new RunPaused('guarded-only', error.message)
        throw new RunPaused('no-progress', `${error.code}: ${error.message}`)
      }
      throw error
    }
  }
  return {
    platform: 'computer', ask: options.ask,
    resolveTarget: async (signal) => {
      root = await options.resolve(signal)
      const target = await service.resolveTargetRoot(root)
      if (bundleId && target.bundleId !== bundleId) throw new RunPaused('guarded-only', 'The target app changed while paused; start a new computer_run.')
      bundleId = target.bundleId
      successor = undefined
    },
    observe: async (signal) => {
      signal?.throwIfAborted()
      if (successor && fresh(successor)) { current = successor; successor = undefined; return current }
      const observed = await service.observe(root, 'semantic')
      signal?.throwIfAborted()
      current = computerPage(observed, service)
      conditionStateId ??= current.stateId
      return current
    },
    isFresh: async (page) => fresh(page),
    // Native refs are positional. A changed outline must be predicted again.
    reobserveOnResume: true,
    sameTarget: (before, after, element) => before.rootId === after.rootId && before.signature === after.signature
      && after.elements.some((e) => e.node === element.node && e.label === element.label && e.editable === element.editable),
    click: (id, signal) => act(planNodeAction(requirePage().refs.get(id), { kind: 'press' }, service.policy.tierFor(requirePage().bundleId)), signal),
    type: async (id, text, signal) => {
      const node = requirePage().refs.get(id)
      await act(node && planNodeAction(node, { kind: 'setText', text }, service.policy.tierFor(requirePage().bundleId)), signal)
    },
    pressEnter: async (id, signal) => {
      const page = requirePage()
      const node = page.refs.get(id)
      if (!node) throw new StaleObservation('The submit field disappeared.')
      // A fresh AX read checks the one app-level focus owner before Return.
      const observed = computerPage(await service.observe(root, 'semantic'), service)
      const focused = observed.refs.get(id)
      if (observed.signature !== page.signature || !focused?.appFocused) throw new StaleObservation('The submit field is not the app-focused AX element. Focus it with computer_act before resuming.')
      current = observed
      await act(planNodeAction(focused, { kind: 'enter' }, service.policy.tierFor(page.bundleId)), signal)
    },
    scroll: async (page, deltaY, signal) => {
      if (!page.scrollRef) throw new RunPaused('no-progress', 'No accessible scroll target is available.')
      // computer_act app-directed scrolling is scoped to the target PID; it
      // does not require activating the app or global physical input.
      const state = service.getStateStore().get(page.stateId)
      const node = state && findNode(state.outline, page.scrollRef)
      await act(node && planNodeAction(node, { kind: 'scroll', dy: deltaY }, service.policy.tierFor(page.bundleId)), signal)
    },
    settle: async () => {}, // service.act already observes and verifies the successor.
    waitReady: async () => true,
    checkDone: async (signal) => {
      if (!options.doneWhen || !conditionStateId) return false
      // waitFor binds the ref to native identity; row insertions must not turn
      // the completion condition into a claim about a different element.
      const result = await service.waitFor(conditionStateId, options.doneWhen, 0, signal)
      if (result.status !== 'verified' && result.status !== 'preexisting') return false
      const state = service.getStateStore().get(result.successorStateId)
      if (!state) throw new RunPaused('no-progress', 'The verified completion snapshot expired. Inspect the app before continuing.')
      const folded = foldOutline(compactOutline(dropOccludedWebAreas(state.outline)))
      current = computerPage({ ...state, outline: folded.outline, truncation: folded }, service)
      root = current.rootId
      successor = undefined
      return current
    },
    changed: (_before, after) => {
      const result = after.outcome
      if (!result) return null
      if (result.diff && (result.diff.added.length || result.diff.removed.length || result.diff.changed.length)) return true
      return result.outcome === 'worked' ? true : result.outcome === 'didnt' ? false : null
    },
    // Each service call releases its resource lane. The normal turn lifecycle
    // owns visuals and dedicated-display placement, including while paused.
    focusGuard: async () => {},
  }
}
