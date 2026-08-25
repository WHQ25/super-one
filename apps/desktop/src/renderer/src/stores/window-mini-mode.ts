import { create } from 'zustand'
import { MINI_WINDOW_SIZE, type WindowFoldStep, type WindowMiniMode } from '@superone/shared/agent-types'

/**
 * `app` → `folding` → `mini` → `unfolding` → `app`.
 *
 * The shell stays mounted through both transition phases — that is where the fold
 * lives. Only once it has collapsed to the width of a single chat column does the tree
 * swap over to the mini UI.
 */
export type WindowMiniPhase = 'app' | 'folding' | 'mini' | 'unfolding'

/**
 * The whole fold, as one move: the chat column narrows, both side panels shed, and the
 * window loses height — all on the same clock, which main animates the window edges
 * over. Sequencing these read as three separate tugs; together they read as the shell
 * collapsing in on itself.
 */
const FOLD_MS = 320

/** Panels animate `width` over this while folding — overrides their idle 300ms. */
export const FOLD_PANEL_MS = FOLD_MS

interface WindowMiniModeState {
  /** Target session — set from the moment the fold starts until the window grows back. */
  mode: WindowMiniMode | null
  phase: WindowMiniPhase
  /** Both side panels are shut, without touching the user's own toggles. */
  panelsFolded: boolean
}

export const useWindowMiniModeStore = create<WindowMiniModeState>(() => ({
  mode: null,
  phase: 'app',
  panelsFolded: false,
}))

export const selectPanelsFolded = (s: WindowMiniModeState): boolean =>
  s.phase !== 'app' && s.panelsFolded

/**
 * True whenever the window is being driven by the fold rather than by the user.
 * Layout code that reacts to window size (panel clamping, minimum-size, the
 * resize-time transition freeze) has to sit these out: the window is walking itself
 * down to one chat column and back, and reacting to those intermediate sizes would rewrite the
 * user's panel widths and fight the animation frame for frame.
 */
export const selectMiniDriven = (s: WindowMiniModeState): boolean => s.phase !== 'app'

const timers: ReturnType<typeof setTimeout>[] = []

function schedule(steps: Array<[delayMs: number, run: () => void]>): void {
  clearSchedule()
  for (const [delayMs, run] of steps) timers.push(setTimeout(run, delayMs))
}

function clearSchedule(): void {
  for (const timer of timers) clearTimeout(timer)
  timers.length = 0
}

const rectOf = (selector: string): DOMRect | null =>
  document.querySelector(selector)?.getBoundingClientRect() ?? null

export interface ShellLayout {
  sidebarWidth: number
  activityWidth: number
  viewportWidth: number
}

/**
 * Turn a measured shell into the moves main animates the window over. Layout knowledge
 * stays here — main never learns what a sidebar is, it just plays the edges it is handed.
 *
 * The width delta is measured against the viewport itself, not summed from the three
 * columns: the columns leave out borders and gutters, and those few pixels used to
 * surface as an instant correction snap at the very end of the fold. Full viewport
 * minus mini width lands exactly.
 * The window origin is deliberately absent from the steps: every layout collapses
 * toward the current top-left corner. Resizing and moving the native window in the same
 * frame lets the compositor briefly shift a stale content buffer, which is visible as
 * text jitter when the chat happens to sit on the right.
 */
export function buildFoldSteps(layout: ShellLayout): WindowFoldStep[] {
  // `min(0, …)` rather than `-max(0, …)`: a window already at the mini width yields a
  // clean 0 instead of -0, which reads as a no-op everywhere downstream.
  const widthDelta = Math.min(0, Math.round(MINI_WINDOW_SIZE.width - layout.viewportWidth))
  return [{
    durationMs: FOLD_MS,
    widthDelta,
    height: MINI_WINDOW_SIZE.height,
  }]
}

function measureShellLayout(): ShellLayout {
  return {
    sidebarWidth: rectOf('[data-sidebar-outer]')?.width ?? 0,
    activityWidth: rectOf('[data-activity-outer]')?.width ?? 0,
    viewportWidth: window.innerWidth,
  }
}

/**
 * Panel widths are driven off the window's *actual* size while the fold runs, instead
 * of animating on their own CSS clock.
 *
 * Two clocks is what made the UI shiver: the window edge is interpolated in main and
 * the panels transitioned in the renderer, so however carefully the curves and
 * durations are matched, the two sample at different instants and the chat column —
 * whose width is `window − panels` — carries every bit of that disagreement. Reading
 * the panel widths back out of the window size collapses it to one clock: whatever the
 * window is right now, that is what the panels are, exactly.
 */
interface FoldTracker {
  /** Window width with the shell fully open — the 0% end of the fold. */
  expandedWidth: number
  /** Total width the window gives up across the fold; the denominator for progress. */
  totalDelta: number
  sidebarFull: number
  activityFull: number
}

function trackerFor(layout: ShellLayout, steps: WindowFoldStep[]): FoldTracker {
  return {
    expandedWidth: layout.viewportWidth,
    totalDelta: Math.max(1, Math.abs(steps[0]?.widthDelta ?? 0)),
    sidebarFull: layout.sidebarWidth,
    activityFull: layout.activityWidth,
  }
}

let tracker: FoldTracker | null = null
/** Layout captured while folding, so the unfold knows what to open back up to. */
let expandedLayout: ShellLayout | null = null

const panelElements = (): HTMLElement[] =>
  ['[data-sidebar-outer]', '[data-activity-outer]']
    .map((selector) => document.querySelector<HTMLElement>(selector))
    .filter((el): el is HTMLElement => el !== null)

/**
 * How open the panels are for a given window width — 1 fully open, 0 fully shut.
 * One direction serves both ways round: folding walks the window width down, unfolding
 * walks it back up, and the panels are a pure function of where it currently is.
 */
export function panelOpenFraction(
  tracker: { expandedWidth: number; totalDelta: number },
  windowWidth: number,
): number {
  const folded = (tracker.expandedWidth - windowWidth) / tracker.totalDelta
  return 1 - Math.min(1, Math.max(0, folded))
}

function syncPanelsToWindow(): void {
  if (!tracker) return
  const open = panelOpenFraction(tracker, window.innerWidth)
  const sidebar = document.querySelector<HTMLElement>('[data-sidebar-outer]')
  const activity = document.querySelector<HTMLElement>('[data-activity-outer]')
  if (sidebar) sidebar.style.width = `${Math.round(tracker.sidebarFull * open)}px`
  if (activity) activity.style.width = `${Math.round(tracker.activityFull * open)}px`
}

function startPanelTracking(next: FoldTracker): void {
  tracker = next
  // The transition would smooth over the per-frame writes and put the panels a beat
  // behind the window again — the exact lag being designed out here.
  for (const el of panelElements()) el.style.transition = 'none'
  window.addEventListener('resize', syncPanelsToWindow)
  syncPanelsToWindow()
}

/** Widths are left on the panels for React to overwrite on its next render. */
function stopPanelTracking(): void {
  window.removeEventListener('resize', syncPanelsToWindow)
  for (const el of panelElements()) el.style.transition = ''
  tracker = null
}

const set = useWindowMiniModeStore.setState
const get = useWindowMiniModeStore.getState

/**
 * When to give up waiting for main's completion signal. The real cue is the IPC
 * promise resolving — main's animation clock starts after an IPC hop, ticks on a
 * timer that stretches under load, and a fixed `setTimeout(FOLD_MS)` here used to
 * fire while the window was still mid-flight, switching the surrounding shell on top
 * of a moving window. The deadline only catches a hung or erroring IPC.
 */
const foldDeadlineMs = (steps: WindowFoldStep[]): number =>
  steps.reduce((sum, step) => sum + step.durationMs, 0) + 800

/**
 * Fold the app shell down onto one session — chat column, both panels and the window
 * height, all in one move.
 *
 * `panelsFolded` stays false for the duration: it describes where the panels *end up*,
 * and flipping it now would have React slam them shut on the first frame. While the
 * fold runs their width belongs to {@link syncPanelsToWindow}, and React — which does
 * not re-render in that window — leaves those writes alone.
 */
export function enterMiniWindow(mode: WindowMiniMode): void {
  if (get().phase !== 'app') return
  const layout = measureShellLayout()
  const steps = buildFoldSteps(layout)
  expandedLayout = layout
  set({ mode, phase: 'folding', panelsFolded: false })
  const done = window.app.convertWindowToMini(mode.projectPath, mode.sessionId, mode.title, steps)
  startPanelTracking(trackerFor(layout, steps))
  const finish = (): void => {
    clearSchedule()
    stopPanelTracking()
    if (get().phase === 'folding') set({ phase: 'mini', panelsFolded: true })
  }
  // The invoke resolves when main's window animation has actually landed — the tree
  // swap (an expensive commit) must not start while the window is still moving.
  void Promise.resolve(done).then(finish, finish)
  schedule([[foldDeadlineMs(steps), finish]])
}

/**
 * Ask for the full window back. The existing App and SessionPane stay mounted; the
 * panels remain folded until {@link beginUnfold} starts the reverse window motion.
 */
export function exitMiniWindow(): void {
  if (get().phase !== 'mini') return
  set({ mode: null, phase: 'unfolding', panelsFolded: true })
}

let unfolding = false

/**
 * Run the beats in reverse, now that the folded shell is on screen.
 *
 * Keeping the panels folded is what makes the reverse animation possible: main rewinds
 * the window edges along the path the fold took while the same panel DOM follows it.
 */
export function beginUnfold(): void {
  if (get().phase !== 'unfolding' || unfolding) return
  unfolding = true
  const done = window.app.restoreWindowFromMini()
  // Mirror image of the fold: `panelsFolded` stays true (React keeps rendering them
  // shut) while the tracker opens them in step with the growing window.
  const steps = expandedLayout ? buildFoldSteps(expandedLayout) : []
  if (expandedLayout) startPanelTracking(trackerFor(expandedLayout, steps))
  const finish = (): void => {
    clearSchedule()
    stopPanelTracking()
    unfolding = false
    if (get().phase === 'unfolding') set({ phase: 'app', panelsFolded: false })
  }
  void Promise.resolve(done).then(finish, finish)
  schedule([[foldDeadlineMs(steps), finish]])
}

/**
 * Main is authoritative about whether this window is converted, and it outlives a
 * renderer reload (dev HMR, Cmd+R). Mid-fold pushes are ignored — they are main
 * echoing back the geometry this renderer asked for.
 */
export function syncWindowMiniModeFromMain(mode: WindowMiniMode | null): void {
  const { phase } = get()
  if (mode && phase === 'app') {
    // Reload landing in an already-converted window: nothing to animate, it is small.
    clearSchedule()
    stopPanelTracking()
    unfolding = false
    set({ mode, phase: 'mini', panelsFolded: true })
    return
  }
  if (!mode && phase === 'mini') exitMiniWindow()
}
