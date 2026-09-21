/**
 * The shared fast inner loop: observe → machine checks → ask Jev → decide → act,
 * suspendable through pause/resume. Everything with a side effect is behind
 * `RunDeps`, so the loop itself is exercised offline against recorded pages.
 */

import { randomUUID } from 'crypto'
import { type ActionSpace, buildActionSpace, clickKindOf, clickVerb, elementByIndex, type HistoryEntry, type SpaceElement } from './action-space'
import type { JevRunAction, JevRunActionOutcome } from '@superone/shared/agent-types'
import type { RawElement, RunObservation } from './observation'
import { decide, type Decision, presetByHint, type Question, type QuestionOption } from './policy'
import { buildRequest, DESKTOP_WORDS, type Preset, type RunWords } from './questions'
import { appendJevTrace, topChoiceProbabilities, traceRequestState, type TraceStep } from './trace'
import { estimateTokens, type JevRequest, type JevResponse } from './typesafe-client'

/** An adapter's verdict on whether the page reacted to the action it just dispatched. */
export interface SettleReport {
  changed: boolean
  fields?: string[]
  elements?: number
}

export interface RunDeps<Page extends RunObservation = RunObservation> {
  ask(request: JevRequest, signal?: AbortSignal): Promise<JevResponse>
  /** Resolve and retain the platform target inside the adapter. */
  resolveTarget(signal?: AbortSignal): Promise<void>
  observe(signal?: AbortSignal): Promise<Page>
  isFresh(page: Page, node?: number, signal?: AbortSignal): Promise<boolean>
  click(node: number, signal?: AbortSignal): Promise<void>
  /** Focus the field and press Enter — the keyboard form submit. */
  pressEnter(node: number, signal?: AbortSignal): Promise<void>
  type(node: number, text: string, signal?: AbortSignal): Promise<void>
  scroll(page: Page, deltaY: number, signal?: AbortSignal): Promise<void>
  /**
   * Add text at the end of a text area, keeping what it holds. Optional: an
   * adapter that offers no `appendable` element is never asked to.
   */
  append?(node: number, text: string, signal?: AbortSignal): Promise<void>
  /** Scroll one named scroll area rather than the page's default; only adapters that offer `scroll` elements need it. */
  scrollArea?(node: number, deltaY: number, signal?: AbortSignal): Promise<void>
  /** Press Escape on the current target; offered as an action only when present. */
  dismiss?(signal?: AbortSignal): Promise<void>
  /** Continue in another root of the same app (`RawElement.root`); the next observe reads it. */
  switchRoot?(rootId: string, signal?: AbortSignal): Promise<void>
  /** Right-click the element; the observation that follows is the context menu it opened. */
  contextMenu?(node: number, signal?: AbortSignal): Promise<void>
  /** Drag the selected element onto the target, center to center. */
  drag?(node: number, target: number, signal?: AbortSignal): Promise<void>
  /**
   * Run actions the caller handed over at a `capability` pause, in this
   * platform's own `*_act` vocabulary, on `page` (§11.4). Optional: without
   * it a hand-over can still bring presets, and the pause says so.
   */
  act?(page: Page, actions: unknown[], signal?: AbortSignal): Promise<void>
  /**
   * A fresh visual observation for a pause: the caller answers a question
   * about a page it has never seen, and a path to a picture of it costs one
   * capture, not context (research doc §11.4). Best effort — a failed capture
   * leaves the pause without an image, never without the question.
   */
  capture?(signal?: AbortSignal): Promise<PauseCapture | null>
  /**
   * After input: let the page react before the next observation. `page` is the
   * observation the action was taken on, so an adapter can wait for a change
   * relative to it instead of a fixed delay.
   */
  settle(page: Page, opts: { node?: number; typed?: boolean }, signal?: AbortSignal): Promise<SettleReport | void>
  waitReady(timeoutMs: number, signal?: AbortSignal): Promise<boolean>
  /**
   * Jev asked to wait: resolve true as soon as the page differs from `page`,
   * false once `timeoutMs` passes unchanged. Adapters without an event source
   * get a polling fallback.
   */
  waitForChange?(page: Page, timeoutMs: number, signal?: AbortSignal): Promise<boolean>
  /** Evaluate the adapter's native completion condition. */
  checkDone(signal?: AbortSignal): Promise<boolean | Page>
  changed(before: Page, after: Page): boolean | null
  focusGuard(active: boolean): Promise<void>
  trace?(entry: TraceStep): void
  now?(): number
  platform?: 'browser' | 'computer' | 'device'
  /** This platform's words for Escape and the secondary press; desktop wording when absent. */
  words?: RunWords
  /** Positional native refs must never reuse a paused snapshot. */
  reobserveOnResume?: boolean
  sameTarget?(before: Page, after: Page, element: RawElement): boolean
}

export interface RunOptions {
  goal: string
  presets: Preset[]
  hasDoneWhen?: boolean
  maxSteps: number
  maxWallMs: number
}

export interface Answer {
  questionId: string
  choice?: string
  value?: unknown
  goal?: string
  abort?: boolean
}

export type RunStatus = 'paused' | 'done' | 'aborted'

/** What the adapter captured for a pause, in the vocabulary of its own snapshot tool. */
export interface PauseCapture {
  /** The state the picture belongs to, when the platform has states; it replaces the snapshot's. */
  stateId?: string
  image: { path: string; width: number; height: number }
  coordinateSpace?: Record<string, unknown>
}

/** The single-action tool's own vocabulary for what a step did: no new words for the caller to learn. */
export type StepOutcome = JevRunActionOutcome

/**
 * One finished step as the caller and the chat both read it: `label` names
 * the element by index for the caller, `op` / `target` are the same words the
 * live `jev_run_update` row used, so a block rebuilt from the result after a
 * reload shows exactly what it showed while the run was open.
 */
export interface CompletedStep extends Partial<Pick<JevRunAction, 'op' | 'target'>> {
  label: string
  outcome: StepOutcome
}

/**
 * The run's own account of its progress since the last pause — what the
 * caller could not otherwise tell apart: a run that is nearly done but whose
 * completion Jev cannot see, and one that never moved (§11.4). Three runs that
 * had already reached their goal were aborted for want of this.
 */
export interface RunProgress {
  /** Steps since the previous pause (or the start); reset on resume. */
  completed: CompletedStep[]
  /** Jev's last verdicts before the pause, when it was asked at all. */
  goal_satisfied?: number
  still_loading?: number
  /** Something that happened to the run itself rather than a step, e.g. an answer discarded. */
  note?: string
}

export interface RunResult {
  status: RunStatus
  runId: string
  question?: Question
  progress: RunProgress
  snapshot: {
    stateId?: string
    target?: Record<string, string>
    url: string
    title: string
    elements: Array<{ index: string; role: string; label: string; value?: string; ref?: string }>
    text: string
    /** A picture of the page at pause time; `relevance` says how much the question depends on it. */
    image?: PauseCapture['image'] & { relevance: 'required' | 'useful' | 'optional' }
    coordinateSpace?: Record<string, unknown>
  } | null
  steps: number
  elapsed_ms: number
  why?: string
}

interface Pending<Page extends RunObservation> {
  question: Question
  page: Page | null
  space: ActionSpace | null
  /** What answering with an element index means; `handed` takes `{ actions?, presets? }`. */
  mode: 'click' | 'type_text' | 'append' | 'switch' | 'context_menu' | 'drag' | 'escape' | 'accept' | 'handed'
  element?: SpaceElement
  presetKey?: string
  /** For a drag pause: the item that would move. */
  target?: SpaceElement
}

const SCROLL_DELTA = 560
/** Jev's consecutive waits get more patience each time: 1 s, 2 s, 4 s, then it must act. */
const WAIT_CAPS_MS = [1000, 2000, 4000]
const WAIT_POLL_MS = 150

export class FastRun<Page extends RunObservation = RunObservation> {
  readonly runId = `r${randomUUID().slice(0, 8)}`
  status: RunStatus | 'running' = 'running'
  private readonly history: HistoryEntry[] = []
  private progress: RunProgress = { completed: [] }
  private steps = 0
  private consecutiveWaits = 0
  private reporter?: (action: JevRunAction) => void
  /** What the adapter's settle concluded, for the trace. */
  private lastSettle: SettleReport | void = undefined
  /**
   * How long that settle took. `act` covers input, settle and the read after
   * it; on a 250-node AX tree each read is seconds, and without this split the
   * trace could not say which of the three a slow step was spending them on.
   */
  private lastSettleMs = 0
  private scrolledSinceChange = false
  /** Jev called the goal satisfied once; a fresh observation must agree before the run finishes. */
  private doneCandidate = false
  private pending: Pending<Page> | null = null
  private lastPage: Page | null = null
  private readonly startedAt: number
  private segmentStartedAt = 0
  private questionSeq = 0

  constructor(private readonly opts: RunOptions, private readonly deps: RunDeps<Page>) {
    this.startedAt = this.now()
  }

  private get words(): RunWords {
    return this.deps.words ?? DESKTOP_WORDS
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  get lastActivity(): number {
    return this.segmentStartedAt
  }

  async start(signal?: AbortSignal): Promise<RunResult> {
    return this.segment(signal, async () => {
      await this.deps.resolveTarget(signal)
      return this.loop(signal)
    })
  }

  async resume(answer: Answer, signal?: AbortSignal): Promise<RunResult> {
    return this.segment(signal, () => this.resumeAnswer(answer, signal))
  }

  private async resumeAnswer(answer: Answer, signal?: AbortSignal): Promise<RunResult> {
    if (this.status !== 'paused' || !this.pending) {
      return this.result('aborted', 'This run is not paused')
    }
    if (answer.goal) this.opts.goal = answer.goal
    if (answer.abort) return this.result('aborted', 'Aborted by the caller')
    if (answer.questionId !== this.pending.question.id) {
      return this.result('aborted', `Answer names question ${answer.questionId}; the pending one is ${this.pending.question.id}`)
    }
    signal?.throwIfAborted()
    // The target may have closed or lost its grant while paused.
    await this.deps.resolveTarget(signal)
    const pending = this.pending
    this.pending = null
    this.status = 'running'
    this.progress = { completed: [] }

    if (answer.choice === 'abort') return this.result('aborted', 'Aborted by the caller')
    if (pending.question.type === 'choice' && !pending.question.options?.some((o) => o.key === answer.choice)) {
      return this.result('aborted', 'Answer did not name an offered option')
    }
    // Offered on a no-progress pause: the caller, who can read the page, says the goal is reached.
    if (answer.choice === 'accept' && pending.mode !== 'accept') return this.result('done', 'Accepted by the caller')
    if (pending.mode === 'accept') {
      if (answer.choice === 'accept') return this.result('done', 'Accepted by the caller')
      // "continue" after a budget pause restarts the step budget; after an
      // obstruction pause it re-observes. It used to also mean "not done yet"
      // after a goal_satisfied pause, and that flag outlived the pause: a run
      // resumed past a menu-bar obstruction had Jev's completion verdict
      // overruled for good and circled a goal it had reached.
      if (pending.question.reason === 'budget') this.steps = 0
      this.lastPage = null
      return this.loop(signal)
    }
    if (!pending.page || !pending.space) return this.loop(signal)
    if (pending.mode === 'handed') return this.resumeHanded(answer, pending, signal)
    if (pending.mode === 'escape') {
      // The key was the question; a fresh page is what it acts on.
      this.lastPage = await this.execute({ kind: 'escape', risk: 0 }, await this.deps.observe(signal), true, true, signal)
      return this.loop(signal)
    }
    let element: SpaceElement | undefined
    let text: string | undefined
    let presetKey = 'answer'
    let clickKey = ''
    if (pending.question.type === 'value') {
      const v = answer.value as { text?: unknown } | undefined
      if (typeof v?.text !== 'string') return this.result('aborted', 'A value answer needs { text }')
      element = pending.element
      text = v.text
    } else if (typeof answer.choice === 'string') {
      element = elementByIndex(pending.space, answer.choice)
      clickKey = answer.choice
      if (element && pending.mode === 'drag' && pending.element && element.dropTarget) {
        // The answer names the destination; the item that moves was the pause's own.
        const source = pending.element
        const next = await this.deps.observe(signal)
        const still = next.elements.some((e) => e.node === source.node && e.dragSource) && next.elements.some((e) => e.node === element!.node && e.dropTarget)
        if (!still || next.blocked) {
          this.lastPage = null
          this.progress.note = 'Page changed while paused; answer discarded'
          return this.loop(signal)
        }
        this.lastPage = await this.execute({ kind: 'drag', element: source, target: element, probability: 1, risk: 0 }, next, true, true, signal)
        return this.loop(signal)
      }
      if (element && (pending.mode === 'type_text' || pending.mode === 'append')) {
        const preset = (pending.presetKey && pending.element?.node === element.node
          ? this.opts.presets.find((p) => p.key === pending.presetKey)
          : undefined) ?? presetByHint(element, this.opts.presets)
        if (!preset) return this.pauseForValue(element, pending.page, pending.space, signal)
        text = preset.value
        presetKey = preset.key
      }
    }
    if (!element) return this.result('aborted', 'Answer did not name an offered option')

    // Reuse the answer while it still names the same target. The scoped guard
    // is the cheap check; when it fails (e.g. the field was upgraded to a
    // combobox, or suggestions appeared next to it) a re-observation that still
    // shows the same node with the same label is close enough — the answer was
    // about that element, not about its surroundings.
    let execPage: Page | null = !this.deps.reobserveOnResume && (await this.deps.isFresh(pending.page, element.node, signal)) ? pending.page : null
    if (!execPage) {
      const next = await this.deps.observe(signal)
      const same = this.deps.sameTarget?.(pending.page, next, element)
        ?? next.elements.some((e) => e.node === element!.node && e.label === element!.label)
      if (same && !next.blocked) execPage = next
    }
    if (execPage) {
      this.lastPage = await this.execute(
        text != null
          ? { kind: pending.mode === 'append' ? 'append' : 'type_text', element, text, presetKey, probability: 1, risk: 0 }
          : pending.mode === 'switch' && element.root
            ? { kind: 'switch', element, probability: 1, risk: 0 }
            : pending.mode === 'context_menu' && element.contextMenu
              ? { kind: 'context_menu', element, probability: 1, risk: 0 }
              : { kind: 'click', key: clickKey, element, probability: 1, risk: 0 },
        execPage,
        true,
        true,
        signal,
      )
    } else {
      this.lastPage = null
      this.progress.note = 'Page changed while paused; answer discarded'
    }
    return this.loop(signal)
  }

  /**
   * A `capability` answer: presets join the run's own, actions run on a fresh
   * page through the platform's act (§11.4). Only actions count as a step —
   * presets are typed later by steps of their own — and they run as approved:
   * the caller wrote them. A page that changed while paused still takes the
   * hand-over; the caller aimed the actions at the pause snapshot's state, and
   * the adapter's own stale check is what refuses a state that has expired.
   */
  private async resumeHanded(answer: Answer, pending: Pending<Page>, signal?: AbortSignal): Promise<RunResult> {
    const value = (answer.value ?? {}) as { actions?: unknown; presets?: unknown }
    const actions = Array.isArray(value.actions) ? value.actions : undefined
    const presets = Array.isArray(value.presets) ? value.presets.filter((p): p is Preset => !!p && typeof p === 'object' && typeof (p as Preset).key === 'string' && typeof (p as Preset).value === 'string') : undefined
    if (!actions?.length && !presets?.length) return this.result('aborted', 'A capability answer needs { actions } and/or { presets }')
    if (presets?.length) {
      const keys = new Set(presets.map((p) => p.key))
      this.opts.presets = [...this.opts.presets.filter((p) => !keys.has(p.key)), ...presets]
      this.progress.note = `${presets.length} preset(s) taken over: ${presets.map((p) => p.key).join(', ')}`
    }
    if (actions?.length) {
      if (!this.deps.act) return this.result('aborted', 'This platform cannot run handed-over actions; hand over presets instead.')
      const page = pending.page && !this.deps.reobserveOnResume && (await this.deps.isFresh(pending.page, undefined, signal)) ? pending.page : await this.deps.observe(signal)
      this.steps++
      this.lastPage = await this.execute({ kind: 'handed', actions, target: pending.element }, page, true, true, signal)
      return this.loop(signal)
    }
    this.lastPage = null
    return this.loop(signal)
  }

  private async pauseForValue(element: SpaceElement, page: Page, space: ActionSpace, _signal?: AbortSignal): Promise<RunResult> {
    return this.pause({
      type: 'value',
      reason: 'uncertain',
      options: [{ key: 'accept', label: 'Finish: the goal is reached as the page stands' }, { key: 'abort', label: 'Stop; hand control back to you' }],
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      context: { why: `No preset matches [${element.index}] ${element.label}`, target: { index: element.index, role: element.role, label: element.label } },
    }, page, space, 'type_text', element)
  }

  private async segment(signal: AbortSignal | undefined, work: () => Promise<RunResult>): Promise<RunResult> {
    this.segmentStartedAt = this.now()
    await this.deps.focusGuard(true)
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          signal?.throwIfAborted()
          return await work()
        } catch (err) {
          if (signal?.aborted) return this.result('aborted', 'Interrupted')
          if (err instanceof StaleObservation) {
            this.lastPage = null
            if (attempt < 5) {
              work = () => this.loop(signal)
              continue
            }
            err = new RunPaused('no-progress', err.message)
          }
          if (err instanceof RunPaused) return await this.pause({
            type: 'choice', reason: err.reason,
            options: [{ key: 'continue', label: 'Re-observe after resolving the obstruction' }, { key: 'abort', label: 'Stop; hand control back to you' }],
            context: { why: err.message },
          }, this.lastPage, null, 'accept', undefined, undefined, true)
          throw err
        }
      }
    } finally {
      await this.deps.focusGuard(false)
    }
  }

  private async loop(signal?: AbortSignal): Promise<RunResult> {
    // A page handed over from resume() was observed right after the answered
    // action; anything older is re-observed.
    let page = this.lastPage
    this.lastPage = null
    let staleRetries = 0
    for (;;) {
      signal?.throwIfAborted()
      if (this.steps >= this.opts.maxSteps) return this.pauseBudget(page, `maxSteps ${this.opts.maxSteps} reached`)
      if (this.now() - this.segmentStartedAt >= this.opts.maxWallMs) return this.pauseBudget(page, `maxWallMs ${this.opts.maxWallMs} reached`)

      const observeStart = this.now()
      if (!page) page = await this.deps.observe(signal)
      const observeMs = this.now() - observeStart
      this.lastPage = page
      if (page.blocked) throw new RunPaused(page.blocked.reason, page.blocked.why)

      // Machine signals first: document loading, then done_when.
      if (page.loading && this.consecutiveWaits < 3) {
        this.consecutiveWaits++
        await this.deps.waitReady(1500, signal)
        this.history.push({ node: -1, kind: 'wait', label: 'Wait (loading)', changedPage: null })
        page = null
        continue
      }
      const completed = this.opts.hasDoneWhen && (await this.deps.checkDone(signal))
      if (completed) {
        this.lastPage = typeof completed === 'object' ? completed : page
        return this.result('done', 'done_when satisfied')
      }

      const space = buildActionSpace({ page, history: this.history })
      const request = buildRequest({ goal: this.opts.goal, page, space, presets: this.opts.presets, last: this.history[this.history.length - 1], history: this.history, words: this.words })
      const response = await this.deps.ask(request, signal)
      this.recordVerdicts(response)
      const decision = decide({
        answers: response.answers,
        space,
        presets: this.opts.presets,
        doneWhenGiven: !!this.opts.hasDoneWhen,
        consecutiveWaits: this.consecutiveWaits,
        scrolledSinceChange: this.scrolledSinceChange,
        page: { url: page.url, title: page.title },
      })
      this.steps++
      const trace: TraceStep = {
        runId: this.runId,
        step: this.steps,
        at: this.now(),
        url: page.url,
        elements: space.elements.length,
        textChars: page.text.length,
        requestTokens: estimateTokens(request),
        usage: response.usage,
        state: traceRequestState(request.state, this.opts.presets),
        topChoices: topChoiceProbabilities(response.answers),
        answers: response.answers,
        model: response.model,
        latencyMs: { jev: response.latencyMs, observe: observeMs },
        decision: describeDecision(decision),
      }

      if (decision.kind === 'wait') {
        const cap = WAIT_CAPS_MS[Math.min(this.consecutiveWaits, WAIT_CAPS_MS.length - 1)]
        this.consecutiveWaits++
        const entry: HistoryEntry = { node: -1, kind: 'wait', label: 'Wait', changedPage: null }
        this.history.push(entry)
        const waitStart = this.now()
        entry.changedPage = await this.waitForChange(page, cap, signal)
        trace.latencyMs!.wait = this.now() - waitStart
        trace.changedPage = entry.changedPage
        this.emit(trace)
        page = null
        continue
      }
      if (decision.kind === 'done') {
        this.emit(trace)
        // Jev judges completion from one observation; a page mid-transition can
        // look finished. Trust it only when a fresh read says so again.
        if (this.doneCandidate) {
          this.lastPage = page
          return this.result('done', decision.why)
        }
        this.doneCandidate = true
        await this.deps.settle(page, { node: -1 }, signal)
        page = null
        continue
      }
      this.doneCandidate = false
      if (decision.kind === 'pause') {
        this.emit(trace)
        return this.pause(decision.question, page, space, decision.mode, decision.element, decision.presetKey, false, decision.target)
      }

      const fresh = await this.deps.isFresh(page, 'element' in decision ? decision.element?.node : undefined, signal)
      if (!fresh) {
        trace.stale = true
        this.emit(trace)
        page = null
        if (++staleRetries > 5) {
          return this.pause({
            type: 'choice',
            reason: 'no-progress',
            options: [{ key: 'abort', label: 'Stop; hand control back to you' }],
            context: { why: 'The page keeps changing under every decision' },
          }, null, null, 'click')
        }
        continue
      }
      const actStart = this.now()
      try {
        page = await this.execute(decision, page, false, false, signal)
      } catch (err) {
        // The step that failed to act is the one a trace is read for; without
        // this the run that pauses inside execute() leaves nothing behind.
        if (!(err instanceof StaleObservation)) { this.emit(trace); throw err }
        trace.stale = true
        this.emit(trace)
        page = null
        if (++staleRetries > 5) throw new RunPaused('no-progress', err.message)
        continue
      }
      staleRetries = 0
      trace.latencyMs!.act = this.now() - actStart
      trace.changedPage = this.history[this.history.length - 1]?.changedPage
      trace.latencyMs!.settle = this.lastSettleMs
      if (this.lastSettle) trace.settled = { ...this.lastSettle, elementsAfter: this.lastPage?.elements.length ?? -1 }
      this.lastSettle = undefined
      this.emit(trace)

      const recent = this.history.filter((h) => h.kind !== 'wait').slice(-3)
      if (recent.length === 3 && recent.every((h) => h.changedPage === false)) {
        return this.pause({
          type: 'choice',
          reason: 'no-progress',
          options: [...space.elements.filter((el) => !el.password && el.clickable !== false).map((el): QuestionOption => ({ key: el.index, label: `${el.role} ${el.label}` })), { key: 'accept', label: 'Finish: the goal is reached as the page stands' }, { key: 'abort', label: 'Stop; hand control back to you' }],
          context: { why: 'Three actions in a row changed nothing', page: { url: page.url, title: page.title } },
        }, page, space, 'click')
      }
    }
  }

  private async settle(page: Page, opts: { node?: number; typed?: boolean }, signal?: AbortSignal): Promise<void> {
    const start = this.now()
    this.lastSettle = await this.deps.settle(page, opts, signal)
    this.lastSettleMs = this.now() - start
  }

  /** Perform one decided action and return the observation that followed it. */
  private async waitForChange(page: Page, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (this.deps.waitForChange) return this.deps.waitForChange(page, timeoutMs, signal)
    const deadline = this.now() + timeoutMs
    for (;;) {
      signal?.throwIfAborted()
      if (this.deps.changed(page, await this.deps.observe(signal)) === true) return true
      if (this.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS))
    }
  }

  private async execute(decision: Exclude<Decision, { kind: 'wait' | 'done' | 'pause' }>, page: Page, approved: boolean, answered = false, signal?: AbortSignal): Promise<Page> {
    const clickKind = decision.kind === 'click' ? clickKindOf(decision.key) : null
    const approvedFlag = approved ? { approved: true as const } : {}
    const entry: HistoryEntry = decision.kind === 'scroll'
      ? { node: decision.element?.node ?? -1, kind: 'scroll', label: `Scroll ${decision.direction}${decision.element ? ` in [${decision.element.index}] ${decision.element.label}` : ''}`, changedPage: null }
      : decision.kind === 'handed'
        ? { node: decision.target?.node ?? -1, kind: 'handed', label: `Handed ${describeHanded(decision.actions)}${decision.target ? ` at [${decision.target.index}] ${decision.target.label}` : ''}`, changedPage: null, approved: true }
      : decision.kind === 'escape'
        ? { node: -1, kind: 'escape', label: this.words.escape.label, changedPage: null, ...approvedFlag }
        : decision.kind === 'switch'
          ? { node: decision.element.node, kind: 'switch', label: `Switch to [${decision.element.index}] ${decision.element.label}`, changedPage: null, ...approvedFlag }
          : decision.kind === 'context_menu'
            ? { node: decision.element.node, kind: 'context_menu', label: `${this.words.contextMenu.verb} [${decision.element.index}] ${decision.element.label}`, changedPage: null, ...approvedFlag }
          : decision.kind === 'drag'
            ? { node: decision.element.node, kind: 'drag', label: `Drag [${decision.element.index}] ${decision.element.label} onto [${decision.target.index}] ${decision.target.label}`, changedPage: null, ...approvedFlag }
          : decision.kind === 'click'
            ? {
              node: decision.element.node,
              kind: clickKind === 'submit' ? 'submit' : 'click',
              label: `${clickVerb(clickKind ?? 'click', decision.element)} [${decision.element.index}] ${decision.element.label}`,
              changedPage: null,
              ...approvedFlag,
            }
            : { node: decision.element.node, kind: decision.kind, label: `${decision.kind === 'append' ? 'Append' : 'Type'} presets.${decision.presetKey} → [${decision.element.index}] ${decision.element.label}`, changedPage: null, ...approvedFlag }
    // Record before acting: a navigation that interrupts the post-action observe must not erase the action.
    this.history.push(entry)
    try {
    if (decision.kind === 'handed') {
      if (!this.deps.act) throw new RunPaused('no-progress', 'This platform cannot run handed-over actions.')
      await this.deps.act(page, decision.actions, signal)
      await this.settle(page, { node: decision.target?.node ?? -1 }, signal)
    } else if (decision.kind === 'scroll') {
      const delta = decision.direction === 'down' ? SCROLL_DELTA : -SCROLL_DELTA
      if (decision.element && this.deps.scrollArea) await this.deps.scrollArea(decision.element.node, delta, signal)
      else await this.deps.scroll(page, delta, signal)
      // Wheel scrolling is animated: without settling, the next observation is
      // taken before the page has moved and every scroll reports no change.
      await this.settle(page, { node: decision.element?.node ?? -1 }, signal)
      this.scrolledSinceChange = true
    } else if (decision.kind === 'escape') {
      if (!this.deps.dismiss) throw new RunPaused('no-progress', 'This platform cannot press Escape.')
      await this.deps.dismiss(signal)
      await this.settle(page, { node: -1 }, signal)
    } else if (decision.kind === 'switch') {
      if (!this.deps.switchRoot || !decision.element.root) throw new RunPaused('no-progress', 'This platform cannot switch roots.')
      // A switch is a new page by definition; there is nothing to settle against.
      await this.deps.switchRoot(decision.element.root, signal)
    } else if (decision.kind === 'context_menu') {
      if (!this.deps.contextMenu) throw new RunPaused('no-progress', 'This platform cannot open a context menu.')
      await this.deps.contextMenu(decision.element.node, signal)
      await this.settle(page, { node: decision.element.node }, signal)
    } else if (decision.kind === 'drag') {
      if (!this.deps.drag) throw new RunPaused('no-progress', 'This platform cannot drag.')
      await this.deps.drag(decision.element.node, decision.target.node, signal)
      await this.settle(page, { node: decision.element.node }, signal)
    } else if (decision.kind === 'click') {
      if (clickKind === 'submit') await this.deps.pressEnter(decision.element.node, signal)
      else await this.deps.click(decision.element.node, signal)
      await this.settle(page, { node: decision.element.node }, signal)
    } else {
      if (decision.kind === 'append') {
        if (!this.deps.append) throw new RunPaused('no-progress', 'This platform cannot append to a text area.')
        await this.deps.append(decision.element.node, decision.text, signal)
      } else {
        await this.deps.type(decision.element.node, decision.text, signal)
      }
      await this.settle(page, { node: decision.element.node, typed: true }, signal)
    }
    } catch (error) {
      if (error instanceof StaleObservation) this.history.pop()
      throw error
    }
    entry.completed = true
    signal?.throwIfAborted()
    this.consecutiveWaits = 0
    const next = await this.deps.observe(signal)
    this.lastPage = next
    const changed = decision.kind === 'switch' ? true : this.deps.changed(page, next)
    entry.changedPage = changed
    if (changed && decision.kind !== 'scroll') this.scrolledSinceChange = false
    const shown = reportableAction(describeDecision(decision), this.words)
    this.progress.completed.push({ label: entry.label, outcome: outcomeOf(changed), ...(shown ? { op: shown.op, ...(shown.target ? { target: shown.target } : {}) } : {}) })
    if (answered) {
      // Answered actions never went through decide(); trace them so a run's
      // history is complete for calibration.
      this.emit({
        runId: this.runId,
        step: this.steps,
        at: this.now(),
        url: page.url,
        elements: page.elements.length,
        textChars: page.text.length,
        decision: { kind: 'answer', ...describeDecision(decision), approved },
        changedPage: changed,
      })
    }
    return next
  }

  private pauseBudget(page: Page | null, why: string): Promise<RunResult> {
    return this.pause({
      type: 'choice',
      reason: 'budget',
      options: [{ key: 'continue', label: 'Continue with a fresh budget' }, { key: 'abort', label: 'Stop; hand control back to you' }],
      context: { why },
    }, page, null, 'accept')
  }

  private async pause(question: Omit<Question, 'id'>, page: Page | null, space: ActionSpace | null, mode: Pending<Page>['mode'], element?: SpaceElement, presetKey?: string, withoutObserve = false, target?: SpaceElement): Promise<RunResult> {
    const observed = page ?? (withoutObserve ? null : await this.deps.observe())
    const built = space ?? (observed ? buildActionSpace({ page: observed, history: this.history }) : null)
    const id = `q${++this.questionSeq}`
    // A platform without `act` can still take presets; the schema says so.
    if (question.reason === 'capability' && !this.deps.act && question.schema) {
      const { actions: _actions, ...properties } = (question.schema.properties ?? {}) as Record<string, unknown>
      question = { ...question, schema: { ...question.schema, properties, required: ['presets'], anyOf: undefined }, context: { ...question.context, why: `${String(question.context.why)} (This platform takes presets only.)` } }
    }
    const full: Question = { id, ...question }
    this.pending = { question: full, page: observed, space: built, mode, element, presetKey, target }
    this.lastPage = observed
    this.status = 'paused'
    // Which pause reasons a picture helps with is a table, not a question for
    // Jev: it reads text and could not answer it better than the table does.
    const relevance = question.reason === 'capability' ? 'required' : question.reason === 'risky' ? 'useful' : 'optional'
    const capture = observed && this.deps.capture ? await this.deps.capture().catch(() => null) : null
    return {
      status: 'paused',
      runId: this.runId,
      question: full,
      progress: this.progress,
      snapshot: observed && built ? this.snapshot(observed, built, capture ? { ...capture, relevance } : undefined) : null,
      steps: this.steps,
      elapsed_ms: this.now() - this.startedAt,
    }
  }

  private recordVerdicts(response: JevResponse): void {
    const goal = response.answers.goal_satisfied
    const loading = response.answers.still_loading
    if (goal?.type === 'noul') this.progress.goal_satisfied = goal.noul
    if (loading?.type === 'noul') this.progress.still_loading = loading.noul
  }

  private snapshot(page: Page, space: ActionSpace, capture?: PauseCapture & { relevance: 'required' | 'useful' | 'optional' }): RunResult['snapshot'] {
    return {
      ...(capture?.stateId ? { stateId: capture.stateId } : page.stateId ? { stateId: page.stateId } : {}),
      ...(capture ? { image: { ...capture.image, relevance: capture.relevance }, ...(capture.coordinateSpace ? { coordinateSpace: capture.coordinateSpace } : {}) } : {}),
      ...(page.target ? { target: page.target } : {}),
      url: page.url,
      title: page.title,
      elements: space.elements.slice(0, 80).map((el) => ({
        index: el.index,
        ...(el.ref ? { ref: el.ref } : {}),
        role: el.role,
        label: el.label,
        ...(el.value ? { value: el.value.slice(0, 120) } : {}),
      })),
      text: page.text.slice(0, 2000),
    }
  }

  private result(status: RunStatus, why: string): RunResult {
    this.status = status
    this.pending = null
    const page = this.lastPage
    const space = page ? buildActionSpace({ page, history: this.history }) : null
    return {
      status,
      runId: this.runId,
      progress: this.progress,
      snapshot: page && space ? this.snapshot(page, space) : null,
      steps: this.steps,
      elapsed_ms: this.now() - this.startedAt,
      why,
    }
  }

  /**
   * Report each action, in the vocabulary of this platform's single-action tool,
   * so the chat can show what the run did while the call is still open. Jev's
   * step numbers and confidences are not part of it — they belong to the trace.
   * Set after construction because the runId the events carry is the run's own.
   */
  setReporter(report: (action: JevRunAction) => void): void {
    this.reporter = report
  }

  private emit(entry: TraceStep): void {
    ;(this.deps.trace ?? appendJevTrace)({ ...entry, platform: this.deps.platform ?? 'browser' })
    const action = reportableAction(entry.decision, this.words)
    // A step is emitted after its settle, so the verdict travels with the row.
    if (action) this.reporter?.(entry.changedPage === undefined ? action : { ...action, outcome: outcomeOf(entry.changedPage) })
  }
}

function outcomeOf(changed: boolean | null): StepOutcome {
  return changed === null ? 'unknown' : changed ? 'worked' : 'didnt'
}

/** What the chat shows for a step: the same op a single-action call would report. */
function reportableAction(decision: Record<string, unknown>, words: RunWords): JevRunAction | null {
  const target = typeof decision.label === 'string' ? decision.label : undefined
  switch (decision.kind) {
    case 'click':
      // Pressing Enter to submit a filled field is a key press, not a click.
      return clickKindOf(String(decision.key ?? '')) === 'submit'
        ? { op: 'press', target }
        : { op: 'click', target }
    case 'type_text':
    case 'append':
      // The value itself stays out of the row: it came from the caller's own
      // `presets`, which the tool block already shows.
      return { op: 'type', target }
    case 'scroll':
      return { op: 'scroll', target: String(decision.direction ?? '') }
    case 'escape':
      return { op: 'press', target: words.escape.target }
    case 'switch':
      return { op: 'press', target: `Switch to ${target ?? ''}`.trim() }
    case 'context_menu':
      return { op: 'click', target: `${words.contextMenu.verb} ${target ?? ''}`.trim() }
    case 'drag':
      return { op: 'press', target: `Drag ${target ?? ''} onto ${String(decision.onto ?? '')}`.trim() }
    case 'handed':
      return { op: 'press', target: `Handed ${String(decision.actions ?? '')}`.trim() }
    case 'wait':
      return { op: 'wait' }
    default:
      // done / pause are the run's outcome, reported by the tool, not an action.
      return null
  }
}

function describeDecision(d: Decision): Record<string, unknown> {
  switch (d.kind) {
    case 'wait':
      return { kind: d.kind, why: d.why }
    case 'done':
      return { kind: d.kind, why: d.why, probability: d.probability }
    case 'scroll':
      return { kind: 'scroll', direction: d.direction, ...(d.element ? { index: d.element.index, label: d.element.label } : {}) }
    case 'click':
      return { kind: 'click', key: d.key, label: d.element.label, probability: d.probability, risk: d.risk }
    case 'type_text':
    case 'append':
      return { kind: d.kind, index: d.element.index, label: d.element.label, preset: d.presetKey, probability: d.probability, risk: d.risk }
    case 'escape':
      return { kind: 'escape', risk: d.risk }
    case 'switch':
      return { kind: 'switch', index: d.element.index, label: d.element.label, root: d.element.root, probability: d.probability, risk: d.risk }
    case 'context_menu':
      return { kind: 'context_menu', index: d.element.index, label: d.element.label, probability: d.probability, risk: d.risk }
    case 'drag':
      return { kind: 'drag', index: d.element.index, label: d.element.label, onto: d.target.label, targetIndex: d.target.index, probability: d.probability, risk: d.risk }
    case 'handed':
      return { kind: 'handed', actions: describeHanded(d.actions), ...(d.target ? { index: d.target.index, label: d.target.label } : {}) }
    case 'pause':
      return { kind: 'pause', reason: d.question.reason, type: d.question.type, why: d.question.context.why }
  }
}

/** "2 actions (click, drag)": the shape of a hand-over, for history and trace; the actions themselves stay in the answer. */
function describeHanded(actions: unknown[]): string {
  const types = [...new Set(actions.map((a) => (a && typeof a === 'object' && typeof (a as { type?: unknown }).type === 'string' ? (a as { type: string }).type : 'action')))]
  return `${actions.length} action${actions.length === 1 ? '' : 's'} (${types.join(', ')})`
}

/** Adapter refusals that require the caller to resolve a capability or UI boundary. */
export class RunPaused extends Error {
  constructor(readonly reason: 'no-progress', message: string) { super(message) }
}

/** Only throw before input has been dispatched; a rejected target is safe to re-observe. */
export class StaleObservation extends Error {}
