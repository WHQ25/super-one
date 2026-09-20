/** Desktop adapter: retain the service's state/epoch and use its action evidence. */
import { type ComputerUseService } from '../computer-use/computer-use-service'
import { compactOutline, dropOccludedWebAreas } from '../computer-use/outline-compact'
import { findNode } from '../computer-use/outline'
import { ComputerUseError, type ActResult, type ComputerUseState, type Condition, type ObserveResult, type UiOutlineNode } from '../computer-use/types'
import { planNodeAction, type NodeActionPlan } from '../computer-use/node-action-plan'
import { type RunDeps, RunPaused, StaleObservation } from './loop'
import { SETTLE_BUDGET_MS, settleByPolling, waitForChangeByPolling, waitReadyByPolling } from './settle'
import type { RawElement, RunObservation } from './observation'

export interface ComputerPage extends RunObservation {
  stateId: string
  rootId: string
  bundleId: string
  refs: Map<number, UiOutlineNode>
  clickKinds: Map<number, 'press' | 'select' | 'open'>
  signature: string
  scrollRef?: string
  outcome?: ActResult
}

const ROLE_MAP: Record<string, string> = { textfield: 'textbox', textarea: 'textbox', searchfield: 'searchbox', combobox: 'combobox', radiobutton: 'radio', popupbutton: 'button', menubaritem: 'menuitem' }

/** What to call an editable control that carries no readable name of its own. */
const EDITABLE_ROLE_LABEL: Record<string, string> = { searchbox: 'Search field', textbox: 'Text field', combobox: 'Combo box' }

const TOGGLE_ROLES = new Set(['checkbox', 'radio', 'switch', 'menuitem', 'togglebutton'])

/**
 * Controls whose value is a position, not something a person reads: TextEdit's
 * ruler put twenty tab-stop offsets ("1.2698412698", "2.5396825396"…) at the
 * top of the page text, ahead of the document, and Jev judged completion on
 * that.
 */
const POSITION_ROLES = new Set(['rulermarker', 'ruler', 'scrollbar', 'splitter', 'valueindicator', 'slider'])

/**
 * Whether a toggle is on, in the shape the shared layer already speaks
 * ('true' / 'false' / 'mixed' — the web reads it off `aria-checked`).
 *
 * AXValue on a toggle is a number, so the raw observation carries "0", "1" or
 * "2" and nothing downstream recognised it: Jev was told a checkbox's value was
 * "1" and never told whether it was checked, and the settle signature could not
 * see a toggle flip either.
 */
function checkedFrom(role: string, value: string): string | undefined {
  if (!TOGGLE_ROLES.has(role)) return undefined
  if (value === '1' || value === 'true') return 'true'
  if (value === '0' || value === 'false') return 'false'
  if (value === '2' || value === 'mixed') return 'mixed'
  return undefined
}

/** The observed window is gone; the app is not. Re-resolve instead of failing the run. */
const VANISHED_ROOT_CODES = new Set(['WINDOW_UNAVAILABLE', 'AX_ROOT_NOT_FOUND'])

/**
 * The native helper raises a plain `Error` carrying a `code` property, and the
 * service passes it through untouched — it is never a `ComputerUseError`. So
 * matching on the class alone silently skipped every helper-originated failure:
 * a vanished window escaped `computer_run` as a failed tool call, and the
 * STALE_STATE / MODAL_BLOCKED / TIER_BLOCKED / NOT_GRANTED mapping below never
 * fired for those either. Match the code, whichever shape carries it.
 */
function errorCode(error: unknown): string | undefined {
  if (error instanceof ComputerUseError) return error.code
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

const MAX_ELEMENTS = 250
const MAX_TEXT = 6000

/** The action's own verdict, which the adapter's `changed` reads instead of comparing observations. */
function outcomeChanged(result: ActResult | undefined): boolean | null {
  if (!result) return null
  if (result.diff && (result.diff.added.length || result.diff.removed.length || result.diff.changed.length)) return true
  return result.outcome === 'worked' ? true : result.outcome === 'didnt' ? false : null
}

/**
 * Where a scroller sits in its range, 0…1; a list with no scroller reads as
 * the middle so both directions stay offered. A disabled scroller is AppKit
 * saying the content fits — TextEdit's one-line document offered scroll_down,
 * and a run that had reached its goal took it instead of finishing.
 */
function scrollPosition(bar: UiOutlineNode | undefined): { up: boolean; down: boolean } {
  if (bar?.enabled === false) return { up: false, down: false }
  const value = Number(bar?.value)
  const at = bar && Number.isFinite(value) ? value : 0.5
  return { up: at > 0, down: at < 1 }
}

/** The first readable descendant — a Finder row is named by its name cell, not by itself. */
function labelSource(node: UiOutlineNode): UiOutlineNode | undefined {
  const stack = [...(node.children ?? [])]
  while (stack.length) {
    const n = stack.shift()!
    // A disclosure triangle's value is its state, not a name.
    if (n.secure || /disclosuretriangle/i.test(n.role)) continue
    if ((n.value || n.name || '').trim()) return n
    stack.unshift(...(n.children ?? []))
  }
  return undefined
}

function isAppleMenu(node: UiOutlineNode): boolean {
  return node.role.toLowerCase() === 'menubaritem' && node.name === 'Apple'
}

/** An observation the adapter can work from: the state's complete outline, only compacted. */
export type ComputerObservation = Pick<ObserveResult, 'stateId' | 'root'> & { outline: UiOutlineNode; nodesOmitted?: number }

export function computerObservation(state: ComputerUseState): ComputerObservation {
  // The folded outline `observe` returns is for a model reading a table; the
  // fast loop needs every semantic target, or a list longer than the fold
  // budget silently loses the row it is looking for.
  return { stateId: state.stateId, root: state.root, outline: compactOutline(dropOccludedWebAreas(state.outline)) }
}

export function computerPage(result: ComputerObservation, service: ComputerUseService): ComputerPage {
  const tier = service.policy.tierFor(result.root.bundleId)
  const elements: RawElement[] = []
  const refs = new Map<number, UiOutlineNode>()
  const clickKinds = new Map<number, 'press' | 'select' | 'open'>()
  const text: string[] = []
  const seen = new Set<string>()
  let scrollRef: string | undefined
  let scrollBar: UiOutlineNode | undefined
  // `menu` is the menu a command sits in — "Sort By" for Date Modified,
  // "Decimal Places" for Calculator's 12. On its own a command's name says
  // too little: Jev read "12" as the digits the goal asked for, chose the
  // decimal-places command over the two digit keys, and the sum came out 7.5.
  // `row` is the name of the selectable row a node sits in, for the one
  // control that has no name of its own and is only meaningful as the row's:
  // its disclosure triangle.
  const walk = (node: UiOutlineNode, menu?: string, row?: string) => {
    const role = node.role.replace(/^AX/, '').toLowerCase()
    const secure = node.secure === true || /secure|password/.test(role)
    const value = secure ? '' : node.value ?? ''
    // A disclosure triangle has no name and its value is its state, which the
    // outline already carries as `expanded`. Offered as it came, Finder's four
    // triangles were four unlabelled candidates with a value of "0": Jev
    // picked the right one by list order alone and could not tell afterwards
    // that "Users" had expanded. It is the row's triangle; name it so.
    const disclosure = role === 'disclosuretriangle'
    const select = planNodeAction(node, { kind: 'select' }, tier)
    const rowName = select ? (node.name || labelSource(node)?.value || labelSource(node)?.name || '').trim() : row
    // The text is what Jev judges completion on, so a row's state goes in it
    // in words: "Users\n1" said nothing about an expanded folder, and a row
    // once selected vanished from the candidates without a trace — the run
    // that had just selected Shared read the page as unchanged and scrolled.
    if (secure || POSITION_ROLES.has(role)) { /* nothing of a secure field is read; a position is not text */ }
    else if (disclosure) text.push(row && node.expanded != null ? `(${row}: ${node.expanded ? 'expanded' : 'collapsed'})` : '')
    else if (select && node.selected && !node.name) text.push(`(${rowName}: selected)`)
    else text.push([node.name, value, node.selected ? '(selected)' : ''].filter(Boolean).join(' '))
    // The menu tree is read closed, complete with submenus, and the helper
    // presses a command in it directly — activating a background app for the
    // press, since AppKit only validates menu items in the active app. So a
    // menu path is one press on its command; the menus on the way are not
    // steps. Offering "View" or "Expand Sort By" sent the run through a menu
    // that opened on screen with every command still disabled.
    const command = node.nativeTarget?.scope === 'menuBar'
    const opensMenu = command && (role === 'menubaritem' || node.expanded != null)
    const enabled = !opensMenu && node.enabled !== false && !node.pictureOnly && !secure
    const editable = !!planNodeAction(node, { kind: 'setText', text: '' }, tier)
    const press = planNodeAction(node, { kind: 'press' }, tier)
    const open = planNodeAction(node, { kind: 'open' }, tier)
    if (!scrollRef && planNodeAction(node, { kind: 'scroll', dy: 1 }, tier)) {
      scrollRef = node.ref
      // The vertical scroller's value says whether there is more above or below.
      scrollBar = node.children?.find((c) => c.role === 'scrollBar' && !!c.bounds && c.bounds.height > c.bounds.width)
    }
    const kinds: Array<'press' | 'select' | 'open' | undefined> = []
    if (select && !node.selected) kinds.push('select')
    else if (!select && (press || editable)) kinds.push(press ? 'press' : undefined)
    if (open) kinds.push('open')
    for (const kind of kinds) {
      if (!enabled || elements.length >= MAX_ELEMENTS) break
      const source = disclosure ? undefined : node.value || node.name ? node : labelSource(node)
      const mapped = command || kind === 'select' || kind === 'open' ? 'button' : ROLE_MAP[role] ?? role
      // An empty macOS text field is anonymous: no AXTitle, no AXDescription,
      // no AXLabel, and no value to read either. System Settings' sidebar
      // search is exactly that, and the rule below dropped it, so `type_text`
      // was never offered and the run could only click and scroll. The web
      // never needed this — a placeholder or aria-label lands in the
      // accessible name there. Name such a field for what it is instead.
      const anonymous = editable ? EDITABLE_ROLE_LABEL[mapped] ?? 'Text field' : ''
      const itemLabel = (disclosure ? row ?? '' : source?.value || source?.name || '').trim() || anonymous
      // A menu item's state is its check mark, not its value.
      const checked = node.checked != null ? String(node.checked) : checkedFrom(role, value)
      // A nameless pop-up button is known by what it shows — the save sheet's
      // file-format menu reads "Rich Text Document" and nothing else — while a
      // toggle's value is its state, which `checked` already carries.
      const shown = checked == null && !disclosure ? value : ''
      const label = kind === 'select' || kind === 'open' ? `${kind === 'select' ? 'Select' : 'Open'} ${itemLabel}`
        : command && menu ? `${menu} ▸ ${node.name}` : disclosure ? itemLabel : node.name || shown || anonymous
      // A row, its name cell and the cell's text field all open the same item:
      // one candidate per intent, keyed on the node the name was read from,
      // which those three share. Keyed on the label it also swallowed a
      // different control that happened to share one — Finder's "Date
      // Modified" column header hid the View ▸ Sort By ▸ Date Modified
      // command, and the run sorted by clicking the header. Nothing unlabelled
      // is offered either — Jev cannot choose it and the main model cannot
      // approve it.
      const identity = `${kind}:${source?.ref ?? node.ref}`
      if (!label.trim() || (kind && (!itemLabel || seen.has(identity)))) continue
      if (kind) seen.add(identity)
      // Each executable intent gets its own candidate. Native refs remain in
      // refs; these IDs only address adapter plans inside one observation.
      const id = elements.length + 1
      refs.set(id, node)
      if (kind) clickKinds.set(id, kind)
      elements.push({ node: id, ref: node.ref, role: mapped,
        label, value: kind === 'select' ? (node.selected ? 'selected' : 'not selected') : disclosure ? '' : value,
        ...(checked ? { checked } : {}),
        ...(node.expanded != null ? { expanded: String(node.expanded) } : {}),
        editable: kind !== 'select' && kind !== 'open' && editable, clickable: !!kind,
        canSubmit: !!planNodeAction(node, { kind: 'enter' }, tier), password: false, submit: false, disabled: false })
    }
    if (!secure) for (const child of node.children ?? []) walk(child, command && node.name ? node.name : menu, rowName)
  }
  // Window content first, app menus last, so the element budget and the pause
  // option list favour what is on screen. The Apple menu is never an in-app
  // goal and would only leak recent-item names into every request.
  const menuBar = result.outline.children?.find((n) => n.nativeTarget?.scope === 'menuBar')
  const content = (result.outline.children ?? []).filter((n) => n !== menuBar)
  walk({ ...result.outline, children: content })
  for (const menu of menuBar?.children ?? []) if (!isAppleMenu(menu)) walk(menu)
  return {
    url: '', title: `${result.root.app} — ${result.root.title}`, text: text.filter(Boolean).join('\n').slice(0, MAX_TEXT),
    elements, omitted: result.nodesOmitted ?? 0, loading: false,
    scroll: { y: 0, height: 0, viewport: 0 },
    canScroll: { down: !!scrollRef && scrollPosition(scrollBar).down, up: !!scrollRef && scrollPosition(scrollBar).up },
    stateId: result.stateId, rootId: result.root.rootId, bundleId: result.root.bundleId, refs, clickKinds, scrollRef,
    target: { app: result.root.app, bundleId: result.root.bundleId, root: result.root.rootId },
    signature: JSON.stringify(result.outline),
    ...(tier === 'read' ? { blocked: { reason: 'no-progress' as const, why: 'The app grant has tier=read; computer_run needs click or full access. Use computer_apps to resolve the grant.' } } : {}),
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
  /** Wall time of the act that produced `successor`, input and successor read included. */
  let actMs = 0
  /** Wall time of the last live read of the window, which is what a settle sample costs. */
  let readMs = 0
  let conditionStateId: string | undefined
  const requirePage = () => {
    if (!current) throw new RunPaused('no-progress', 'Take a new computer snapshot before continuing.')
    return current
  }
  const pageFor = (stateId: string, missing = 'The observed state expired before it could be read. Take a new computer snapshot before continuing.') => {
    const state = service.getStateStore().get(stateId)
    if (!state) throw new RunPaused('no-progress', missing)
    return computerPage(computerObservation(state), service)
  }
  const fresh = (page: ComputerPage) => {
    const state = service.getStateStore().get(page.stateId)
    return !!state && state.epoch === service.getScheduler().epoch(state.resourceKey)
  }
  /**
   * An app may replace its window rather than update it — System Settings swaps
   * the whole window when its sidebar search resolves — and the helper then
   * refuses the old window id outright. The app is still running and still
   * granted, so re-resolve its current root and read that, rather than letting
   * the error escape `computer_run` as a failed tool call. The browser line got
   * the same recovery in a766a53b; the note there that "the computer adapter
   * already throws StaleObservation" held for the act path only, not for
   * observation, which is why this one survived that fix.
   */
  const observeRoot = async (signal?: AbortSignal) => {
    const started = Date.now()
    try {
      return await service.observe(root, 'semantic')
    } catch (error) {
      const code = errorCode(error)
      if (!code || !VANISHED_ROOT_CODES.has(code) || !bundleId) throw error
      const target = await service.resolveTargetRoot(undefined, bundleId)
      signal?.throwIfAborted()
      root = target.rootId
      return await service.observe(root, 'semantic')
    } finally {
      readMs = Date.now() - started
    }
  }
  /**
   * A live read, bypassing the pending successor. Settling has to watch the
   * surface move; replaying the state the action already produced would report
   * "stable" on its first sample every time.
   */
  const observeFresh = async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const observed = await observeRoot(signal)
    signal?.throwIfAborted()
    return pageFor(observed.stateId)
  }
  const act = async (plan: NodeActionPlan | undefined, signal?: AbortSignal) => {
    if (!plan) throw new RunPaused('no-progress', 'The observed target does not support this computer_act operation. Inspect a fresh snapshot before continuing.')
    const page = requirePage()
    if (!fresh(page)) throw new StaleObservation('The desktop resource changed before input.')
    signal?.throwIfAborted()
    const started = Date.now()
    try {
      const result = await service.act(page.stateId, plan.actions, { signal, expect: plan.expect, timeoutMs: 1200 })
      actMs = Date.now() - started
      const state = service.getStateStore().get(result.successorStateId)
      if (!state) throw new RunPaused('no-progress', 'The action completed but its successor state is unavailable. Inspect before retrying.')
      if (state.root.bundleId !== bundleId) throw new RunPaused('no-progress', 'The action switched applications. Resolve the new app grant with computer_apps before continuing.')
      successor = { ...computerPage(computerObservation(state), service), outcome: result }
      root = state.root.rootId
    } catch (error) {
      const code = errorCode(error)
      if (code) {
        const message = error instanceof Error ? error.message : String(error)
        // The window this action was aimed at is gone; the next observation
        // re-resolves the app's current root, so this is stale, not fatal.
        if (code === 'STALE_STATE' || VANISHED_ROOT_CODES.has(code)) throw new StaleObservation(message)
        if (['MODAL_BLOCKED', 'TIER_BLOCKED', 'NOT_GRANTED'].includes(code)) throw new RunPaused('no-progress', message)
        throw new RunPaused('no-progress', `${code}: ${message}`)
      }
      throw error
    }
  }
  return {
    platform: 'computer', ask: options.ask,
    resolveTarget: async (signal) => {
      root = await options.resolve(signal)
      const target = await service.resolveTargetRoot(root)
      if (bundleId && target.bundleId !== bundleId) throw new RunPaused('no-progress', 'The target app changed while paused; start a new computer_run.')
      bundleId = target.bundleId
      successor = undefined
    },
    observe: async (signal) => {
      signal?.throwIfAborted()
      if (successor && fresh(successor)) { current = successor; successor = undefined; return current }
      const observed = await observeRoot(signal)
      signal?.throwIfAborted()
      current = pageFor(observed.stateId)
      conditionStateId ??= current.stateId
      return current
    },
    isFresh: async (page) => fresh(page),
    // Native refs are positional. A changed outline must be predicted again.
    reobserveOnResume: true,
    // Menus and focus flags churn between two reads of the same window, so a
    // whole-outline signature would discard nearly every paused answer. The
    // element is the same when its id, label and native ref all agree.
    sameTarget: (before, after, element) => before.rootId === after.rootId
      && after.refs.get(element.node)?.ref === before.refs.get(element.node)?.ref
      && after.elements.some((e) => e.node === element.node && e.label === element.label && e.editable === element.editable),
    click: (id, signal) => {
      const page = requirePage()
      const kind = page.clickKinds.get(id)
      return act(kind && planNodeAction(page.refs.get(id), { kind }, service.policy.tierFor(page.bundleId)), signal)
    },
    type: async (id, text, signal) => {
      const node = requirePage().refs.get(id)
      await act(node && planNodeAction(node, { kind: 'setText', text }, service.policy.tierFor(requirePage().bundleId)), signal)
    },
    pressEnter: async (id, signal) => {
      const page = requirePage()
      const node = page.refs.get(id)
      if (!node) throw new StaleObservation('The submit field disappeared.')
      // A fresh AX read checks the one app-level focus owner before Return.
      const observed = pageFor((await service.observe(root, 'semantic')).stateId)
      const focused = observed.refs.get(id)
      if (observed.signature !== page.signature || !focused?.appFocused) throw new StaleObservation('The submit field is not the app-focused AX element. Focus it with computer_act before resuming.')
      current = observed
      await act(planNodeAction(focused, { kind: 'enter' }, service.policy.tierFor(page.bundleId)), signal)
    },
    scroll: async (page, deltaY, signal) => {
      if (!page.scrollRef) throw new RunPaused('no-progress', 'No accessible scroll target is available.')
      // A scroll with a ref is a scroll bar value write, scoped to the target
      // app; it does not require activating the app.
      const state = service.getStateStore().get(page.stateId)
      const node = state && findNode(state.outline, page.scrollRef)
      await act(node && planNodeAction(node, { kind: 'scroll', dy: deltaY }, service.policy.tierFor(page.bundleId)), signal)
    },
    /**
     * `service.act` only holds for an `expect` condition, and the plans a run
     * makes carry one for setText alone — a click returns the moment the first
     * read comes back, mid-animation. So the run settles for itself.
     *
     * The settled observation replaces the act's successor while keeping its
     * verdict, so `changed` still sees what the action did and the loop's next
     * `observe()` costs nothing.
     *
     * Settling assumes a sample is cheap next to its budget, which holds for a
     * small window (~300ms) and not for a 250-node Finder list (~9s a read).
     * There the act itself — input plus the successor read — already outlasts
     * the whole budget: the successor was read after any moment a settle could
     * have waited for, and one more sample costs another full read while never
     * confirming stillness, which takes two. So when the act spanned the
     * budget the successor stands as the settled observation. Measured per
     * act, so a run that leaves the long list gets its settle back.
     *
     * Only when it was the read that took the time, though. A menu command in
     * a background app is pressed by activating the app and waiting for its
     * menus to validate, ~1–2s on its own, and TextEdit's File ▸ Save… spanned
     * the budget that way with a window that reads in 300ms: the sheet it
     * opens is exactly what a settle is for, and one is affordable.
     */
    settle: async (page, _opts, signal) => {
      const outcome = successor?.outcome
      if (outcome && actMs >= SETTLE_BUDGET_MS && readMs >= SETTLE_BUDGET_MS / 2) {
        return { changed: outcomeChanged(outcome) === true, fields: ['act-outlasted-budget'], elements: successor!.elements.length }
      }
      const settled = await settleByPolling(page, observeFresh, signal)
      if (settled.page) successor = outcome ? { ...settled.page, outcome } : settled.page
      return settled.report
    },
    waitReady: (timeoutMs, signal) => waitReadyByPolling(timeoutMs, observeFresh, signal),
    waitForChange: (page, timeoutMs, signal) => waitForChangeByPolling(page, timeoutMs, observeFresh, signal),
    checkDone: async (signal) => {
      if (!options.doneWhen || !conditionStateId) return false
      // waitFor binds the ref to native identity; row insertions must not turn
      // the completion condition into a claim about a different element.
      const result = await service.waitFor(conditionStateId, options.doneWhen, 0, signal)
      if (result.status !== 'verified' && result.status !== 'preexisting') return false
      current = pageFor(result.successorStateId, 'The verified completion snapshot expired. Inspect the app before continuing.')
      root = current.rootId
      successor = undefined
      return current
    },
    changed: (_before, after) => outcomeChanged(after.outcome),
    // Each service call releases its resource lane. The normal turn lifecycle
    // owns visuals and dedicated-display placement, including while paused.
    focusGuard: async () => {},
  }
}
