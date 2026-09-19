/**
 * The shared fast inner loop: observe → machine checks → ask Jev → decide → act,
 * suspendable through pause/resume. Everything with a side effect is behind
 * `RunDeps`, so the loop itself is exercised offline against recorded pages.
 */

import { randomUUID } from 'crypto'
import { type ActionSpace, buildActionSpace, clickKindOf, elementByIndex, type HistoryEntry, originOf, type SpaceElement } from './action-space'
import type { RunObservation } from './observation'
import { decide, type Decision, presetByHint, type Question, type QuestionOption } from './policy'
import { buildRequest, type Preset } from './questions'
import { appendJevTrace, topChoiceProbabilities, traceRequestState, type TraceStep } from './trace'
import { estimateTokens, type JevRequest, type JevResponse } from './typesafe-client'

export interface RunDeps<Page extends RunObservation = RunObservation> {
  ask(request: JevRequest, signal?: AbortSignal): Promise<JevResponse>
  /** Resolve and retain the platform target inside the adapter. */
  resolveTarget(): Promise<void>
  observe(): Promise<Page>
  isFresh(page: Page, node?: number): Promise<boolean>
  click(node: number): Promise<void>
  /** Focus the field and press Enter — the keyboard form submit. */
  pressEnter(node: number): Promise<void>
  type(node: number, text: string): Promise<void>
  scroll(page: Page, deltaY: number): Promise<void>
  settle(opts: { node?: number; typed?: boolean }): Promise<void>
  waitReady(timeoutMs: number): Promise<boolean>
  /** Evaluate the adapter's native completion condition. */
  checkDone(): Promise<boolean>
  changed(before: Page, after: Page): boolean | null
  focusGuard(active: boolean): Promise<void>
  trace?(entry: TraceStep): void
  now?(): number
}

export interface RunOptions {
  goal: string
  presets: Preset[]
  allow: string[]
  avoid: string[]
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

export interface RunResult {
  status: RunStatus
  runId: string
  question?: Question
  since_last: string[]
  snapshot: {
    url: string
    title: string
    elements: Array<{ index: string; role: string; label: string; value?: string; guarded?: true }>
    text: string
  } | null
  steps: number
  elapsed_ms: number
  why?: string
}

interface Pending<Page extends RunObservation> {
  question: Question
  page: Page
  space: ActionSpace
  /** What answering with an element index means. */
  mode: 'click' | 'type_text' | 'accept'
  element?: SpaceElement
  presetKey?: string
}

const SCROLL_DELTA = 560
const WAIT_MS = 200

export class FastRun<Page extends RunObservation = RunObservation> {
  readonly runId = `r${randomUUID().slice(0, 8)}`
  status: RunStatus | 'running' = 'running'
  private readonly history: HistoryEntry[] = []
  private sinceLast: string[] = []
  private steps = 0
  private consecutiveWaits = 0
  private scrolledSinceChange = false
  private continueDespiteSatisfied = false
  private readonly origins = new Set<string>()
  private pending: Pending<Page> | null = null
  private lastPage: Page | null = null
  private readonly startedAt: number
  private segmentStartedAt = 0
  private questionSeq = 0

  constructor(private readonly opts: RunOptions, private readonly deps: RunDeps<Page>) {
    this.startedAt = this.now()
    for (const m of opts.goal.match(/https?:\/\/[^\s)"']+/g) ?? []) {
      const origin = originOf(m)
      if (origin) this.origins.add(origin)
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  get lastActivity(): number {
    return this.segmentStartedAt
  }

  async start(signal?: AbortSignal): Promise<RunResult> {
    await this.deps.resolveTarget()
    return this.segment(signal)
  }

  async resume(answer: Answer, signal?: AbortSignal): Promise<RunResult> {
    if (this.status !== 'paused' || !this.pending) {
      return this.result('aborted', 'This run is not paused')
    }
    if (answer.goal) this.opts.goal = answer.goal
    if (answer.abort) return this.result('aborted', 'Aborted by the caller')
    if (answer.questionId !== this.pending.question.id) {
      return this.result('aborted', `Answer names question ${answer.questionId}; the pending one is ${this.pending.question.id}`)
    }
    // The tab may have been closed while paused; re-resolving is what tells us.
    await this.deps.resolveTarget()
    const pending = this.pending
    this.pending = null
    this.status = 'running'
    this.sinceLast = []

    if (answer.choice === 'abort') return this.result('aborted', 'Aborted by the caller')
    if (pending.mode === 'accept') {
      if (answer.choice === 'accept') return this.result('done', 'Accepted by the caller')
      // "continue" after a budget pause restarts the step budget; after a
      // goal_satisfied pause it means "not done yet".
      if (pending.question.reason === 'budget') this.steps = 0
      else this.continueDespiteSatisfied = true
      this.lastPage = null
      return this.segment(signal)
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
      if (element && pending.mode === 'type_text') {
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
    let execPage: Page | null = (await this.deps.isFresh(pending.page, element.node)) ? pending.page : null
    if (!execPage) {
      const next = await this.deps.observe()
      if (next.elements.some((e) => e.node === element!.node && e.label === element!.label)) execPage = next
    }
    if (execPage) {
      this.lastPage = await this.execute(
        text != null ? { kind: 'type_text', element, text, presetKey, probability: 1 } : { kind: 'click', key: clickKey, element, probability: 1 },
        execPage,
        element.risk === 'guarded' || clickKindOf(clickKey) === 'submit',
        true,
      )
    } else {
      this.lastPage = null
      this.sinceLast.push('Page changed while paused; answer discarded')
    }
    return this.segment(signal)
  }

  private async pauseForValue(element: SpaceElement, page: Page, space: ActionSpace, _signal?: AbortSignal): Promise<RunResult> {
    return this.pause({
      type: 'value',
      reason: 'uncertain',
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      context: { why: `No preset matches [${element.index}] ${element.label}`, target: { index: element.index, role: element.role, label: element.label } },
    }, page, space, 'type_text', element)
  }

  private async segment(signal?: AbortSignal): Promise<RunResult> {
    this.segmentStartedAt = this.now()
    await this.deps.focusGuard(true)
    try {
      return await this.loop(signal)
    } catch (err) {
      if (signal?.aborted) return this.result('aborted', 'Interrupted')
      throw err
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
      if (!page) page = await this.deps.observe()
      const observeMs = this.now() - observeStart
      if (this.origins.size === 0) {
        const origin = originOf(page.url)
        if (origin) this.origins.add(origin)
      }

      // Machine signals first: document loading, then done_when.
      if (page.loading && this.consecutiveWaits < 3) {
        this.consecutiveWaits++
        await this.deps.waitReady(1500)
        this.history.push({ node: -1, kind: 'wait', label: 'Wait (loading)', changedPage: null, guarded: false })
        page = null
        continue
      }
      if (this.opts.hasDoneWhen && (await this.deps.checkDone())) {
        this.lastPage = page
        return this.result('done', 'done_when satisfied')
      }

      const space = buildActionSpace({ page, origins: this.origins, allow: this.opts.allow, avoid: this.opts.avoid, history: this.history })
      const request = buildRequest({ goal: this.opts.goal, page, space, presets: this.opts.presets, last: this.history[this.history.length - 1] })
      const response = await this.deps.ask(request, signal)
      const decision = decide({
        answers: response.answers,
        space,
        presets: this.opts.presets,
        doneWhenGiven: !!this.opts.hasDoneWhen || this.continueDespiteSatisfied,
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
        this.consecutiveWaits++
        this.history.push({ node: -1, kind: 'wait', label: 'Wait', changedPage: null, guarded: false })
        this.emit(trace)
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
        page = null
        continue
      }
      if (decision.kind === 'done') {
        this.emit(trace)
        this.lastPage = page
        return this.result('done', decision.why)
      }
      if (decision.kind === 'pause') {
        this.emit(trace)
        return this.pause(decision.question, page, space, decision.mode, decision.element, decision.presetKey)
      }

      const fresh = decision.kind === 'scroll' ? true : await this.deps.isFresh(page, decision.element.node)
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
      staleRetries = 0
      const actStart = this.now()
      page = await this.execute(decision, page, false)
      trace.latencyMs!.act = this.now() - actStart
      trace.changedPage = this.history[this.history.length - 1]?.changedPage
      this.emit(trace)

      const recent = this.history.filter((h) => h.kind !== 'wait').slice(-3)
      if (recent.length === 3 && recent.every((h) => h.changedPage === false)) {
        return this.pause({
          type: 'choice',
          reason: 'no-progress',
          options: [...space.elements.filter((el) => !el.password).map((el): QuestionOption => ({ key: el.index, label: `${el.role} ${el.label}` })), { key: 'abort', label: 'Stop; hand control back to you' }],
          context: { why: 'Three actions in a row changed nothing', page: { url: page.url, title: page.title } },
        }, page, space, 'click')
      }
    }
  }

  /** Perform one decided action and return the observation that followed it. */
  private async execute(decision: Exclude<Decision, { kind: 'wait' | 'done' | 'pause' }>, page: Page, guarded: boolean, answered = false): Promise<Page> {
    const clickKind = decision.kind === 'click' ? clickKindOf(decision.key) : null
    const entry: HistoryEntry = decision.kind === 'scroll'
      ? { node: -1, kind: 'scroll', label: `Scroll ${decision.direction}`, changedPage: null, guarded: false }
      : decision.kind === 'click'
        ? {
          node: decision.element.node,
          kind: clickKind === 'submit' ? 'submit' : 'click',
          label: `${clickKind === 'open' ? 'Open' : clickKind === 'submit' ? 'Press Enter in' : 'Click'} [${decision.element.index}] ${decision.element.label}`,
          changedPage: null,
          guarded,
        }
        : { node: decision.element.node, kind: 'type_text', label: `Type presets.${decision.presetKey} → [${decision.element.index}] ${decision.element.label}`, changedPage: null, guarded }
    // Record before acting: a navigation that interrupts the post-action observe must not erase the action.
    this.history.push(entry)
    if (decision.kind === 'scroll') {
      await this.deps.scroll(page, decision.direction === 'down' ? SCROLL_DELTA : -SCROLL_DELTA)
      this.scrolledSinceChange = true
    } else if (decision.kind === 'click') {
      if (clickKind === 'submit') await this.deps.pressEnter(decision.element.node)
      else await this.deps.click(decision.element.node)
      await this.deps.settle({ node: decision.element.node })
    } else {
      await this.deps.type(decision.element.node, decision.text)
      await this.deps.settle({ node: decision.element.node, typed: true })
    }
    this.consecutiveWaits = 0
    const next = await this.deps.observe()
    const changed = this.deps.changed(page, next)
    entry.changedPage = changed
    if (changed && decision.kind !== 'scroll') this.scrolledSinceChange = false
    this.sinceLast.push(`${entry.label}${changed ? '' : ' (no change)'}`)
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
        decision: { kind: 'answer', ...describeDecision(decision), guarded },
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

  private async pause(question: Omit<Question, 'id'>, page: Page | null, space: ActionSpace | null, mode: Pending<Page>['mode'], element?: SpaceElement, presetKey?: string): Promise<RunResult> {
    const observed = page ?? (await this.deps.observe())
    const built = space ?? buildActionSpace({ page: observed, origins: this.origins, allow: this.opts.allow, avoid: this.opts.avoid, history: this.history })
    const id = `q${++this.questionSeq}`
    const full: Question = { id, ...question }
    this.pending = { question: full, page: observed, space: built, mode, element, presetKey }
    this.lastPage = observed
    this.status = 'paused'
    return {
      status: 'paused',
      runId: this.runId,
      question: full,
      since_last: this.sinceLast,
      snapshot: this.snapshot(observed, built),
      steps: this.steps,
      elapsed_ms: this.now() - this.startedAt,
    }
  }

  private snapshot(page: Page, space: ActionSpace): RunResult['snapshot'] {
    return {
      url: page.url,
      title: page.title,
      elements: space.elements.slice(0, 80).map((el) => ({
        index: el.index,
        role: el.role,
        label: el.label,
        ...(el.value ? { value: el.value.slice(0, 120) } : {}),
        ...(el.risk === 'guarded' ? { guarded: true as const } : {}),
      })),
      text: page.text.slice(0, 2000),
    }
  }

  private result(status: RunStatus, why: string): RunResult {
    this.status = status
    this.pending = null
    const page = this.lastPage
    const space = page ? buildActionSpace({ page, origins: this.origins, allow: this.opts.allow, avoid: this.opts.avoid, history: this.history }) : null
    return {
      status,
      runId: this.runId,
      since_last: this.sinceLast,
      snapshot: page && space ? this.snapshot(page, space) : null,
      steps: this.steps,
      elapsed_ms: this.now() - this.startedAt,
      why,
    }
  }

  private emit(entry: TraceStep): void {
    ;(this.deps.trace ?? appendJevTrace)(entry)
  }
}

function describeDecision(d: Decision): Record<string, unknown> {
  switch (d.kind) {
    case 'wait':
    case 'done':
      return { kind: d.kind, why: d.why }
    case 'scroll':
      return { kind: 'scroll', direction: d.direction }
    case 'click':
      return { kind: 'click', key: d.key, label: d.element.label, probability: d.probability }
    case 'type_text':
      return { kind: 'type_text', index: d.element.index, label: d.element.label, preset: d.presetKey, probability: d.probability }
    case 'pause':
      return { kind: 'pause', reason: d.question.reason, type: d.question.type, why: d.question.context.why }
  }
}
