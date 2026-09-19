/**
 * `browser_run`: a goal-level browser tool driven by the Jev fast inner loop.
 * Registered on both browser surfaces; gated at execution time on the
 * experimental setting, CDP, and a stored TypeSafe key (mid-session toggles
 * take effect immediately, matching the other experimental browser tools).
 */

import { z } from 'zod'
import { readAppSettings } from '../app-settings-service'
import { browserFocusGuard } from '../browser/browser-automation-bridge'
import { isCdpEnabled, resolveCdpTarget } from '../browser/browser-cdp'
import { browserErrorReply, browserTextReply, type BrowserToolReply } from '../mcp/browser-mcp-replies'
import { checkDoneWhen, clickNode, hasDoneWhen, isFresh, observePage, pressEnterInNode, scrollPage, settleAfter, typeIntoNode, waitForDocumentComplete } from './browser-page'
import { getJevApiKey } from './jev-api-key'
import { type Answer, BrowserRun, type RunDeps, type RunResult } from './loop'
import { storePausedRun, takePausedRun } from './run-store'
import { createJevClient, type JevClient } from './typesafe-client'

export const BROWSER_RUN_DESCRIPTION =
  'Experimental (requires the Jev fast loop setting): pursue a multi-step page goal — clicks, typing, scrolling — with a fast model choosing each step, so you do not pay a turn per click. '
  + 'Start with goal (+ presets for values to type, done_when for a machine-checkable finish, allow/avoid for buttons). '
  + 'Risky buttons (submit, delete, pay, cross-origin links) are never pressed without asking: the call returns status=paused with a question; answer it by calling again with runId + answer. '
  + 'Use for click/fill-heavy tasks on one tab; use browser_act for single steps, drag, keys, uploads.'

export const browserRunInputShape = {
  description: z.string().optional().describe("Short, human-friendly summary of the goal for the user watching, in the conversation's language."),
  goal: z.string().optional().describe('What to achieve on the current page, including when to stop. Required to start a run.'),
  tab: z.string().optional().describe('Browser view id. Omit to target the focused browser view.'),
  presets: z.array(z.object({
    key: z.string().min(1).describe('Short name, e.g. Title.'),
    value: z.string().describe('The full text to type.'),
    field: z.string().optional().describe('Hint naming the field it belongs in, e.g. "the title textbox".'),
  })).max(20).optional().describe('Values the loop may type. Never include passwords.'),
  allow: z.array(z.string()).optional().describe('Button labels (substring, case-insensitive) the loop may press without asking, e.g. ["Create"]. "Enter" allows pressing Enter in any filled field (keyboard submit).'),
  avoid: z.array(z.string()).optional().describe('Element labels to remove from the page entirely.'),
  done_when: z.object({
    selector: z.string().optional(),
    selectorGone: z.string().optional(),
    text: z.string().optional(),
    urlIncludes: z.string().optional(),
    urlMatches: z.string().optional().describe('JavaScript regex source matched against the page URL.'),
  }).optional().describe('Machine-checkable completion condition (AND-combined, same vocabulary as browser_wait_for). Strongly recommended.'),
  maxSteps: z.number().int().min(1).max(100).optional().describe('Default 30.'),
  maxWallMs: z.number().int().min(5_000).max(300_000).optional().describe('Wall-clock budget per call before pausing. Default 45000.'),
  runId: z.string().optional().describe('From a paused result. Resumes that run with `answer`.'),
  answer: z.object({
    questionId: z.string(),
    choice: z.string().optional().describe('An option key from the question, or "abort".'),
    value: z.record(z.string(), z.unknown()).optional().describe('For type=value questions: { text }.'),
    goal: z.string().optional().describe('Optionally revise the goal.'),
    abort: z.boolean().optional(),
  }).optional().describe('Reply to the pending question when resuming.'),
}

const browserRunSchema = z.object(browserRunInputShape)
export type BrowserRunArgs = z.infer<typeof browserRunSchema>

const DEFAULT_MAX_STEPS = 30
const DEFAULT_MAX_WALL_MS = 45_000

export function jevGateError(): string | null {
  const settings = readAppSettings()
  if (!settings.jevFastLoopEnabled) return "The 'Jev fast inner loop' experimental browser tool is disabled. Enable it in Settings → Browser → Experimental Tools."
  if (!isCdpEnabled()) return 'browser_run requires the browser CDP setting. Enable it in Settings → Browser.'
  if (!getJevApiKey()) return 'No Jev API key is stored. Enter one in Settings → Browser → Experimental Tools → Jev fast inner loop.'
  return null
}

let client: JevClient | null = null
let clientKey = ''

function jevClient(): JevClient {
  const key = getJevApiKey()
  if (!client || clientKey !== key) {
    client = createJevClient({ apiKey: key })
    clientKey = key
  }
  return client
}

function depsFor(sessionId: string, tab: string | undefined): RunDeps {
  return {
    ask: (request, signal) => jevClient().ask(request, signal),
    resolveTarget: () => resolveCdpTarget(sessionId, tab),
    observe: observePage,
    isFresh,
    click: clickNode,
    pressEnter: pressEnterInNode,
    type: typeIntoNode,
    scroll: scrollPage,
    settle: settleAfter,
    waitReady: waitForDocumentComplete,
    checkDone: checkDoneWhen,
    focusGuard: (active) => browserFocusGuard(sessionId, active),
  }
}

function reply(sessionId: string, run: BrowserRun, result: RunResult): BrowserToolReply {
  if (result.status === 'paused') {
    storePausedRun(sessionId, run)
    return browserTextReply({
      ...result,
      next: 'Answer by calling browser_run again with { runId, answer: { questionId, choice | value } }. You may inspect the page with other browser tools first; pass answer.abort=true to take over.',
    })
  }
  return browserTextReply(result)
}

export async function executeBrowserRun(sessionId: string, rawArgs: Record<string, unknown>, signal?: AbortSignal): Promise<BrowserToolReply> {
  const gate = jevGateError()
  if (gate) return browserErrorReply(new Error(gate))
  const parsed = browserRunSchema.safeParse(rawArgs)
  if (!parsed.success) return browserErrorReply(new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')))
  const args = parsed.data
  try {
    if (args.runId) {
      if (!args.answer) return browserErrorReply(new Error('Resuming a run needs `answer`.'))
      const taken = takePausedRun(sessionId, args.runId)
      if (typeof taken === 'string') {
        return browserErrorReply(new Error(
          taken === 'missing' ? `No paused run ${args.runId}. Start a new run with goal.`
            : taken === 'expired' ? `Run ${args.runId} expired (5 min). Start a new run with goal.`
              : `Run ${args.runId} belongs to another session.`,
        ))
      }
      return reply(sessionId, taken, await taken.resume(args.answer as Answer, signal))
    }
    if (!args.goal?.trim()) return browserErrorReply(new Error('`goal` is required to start a run (or pass runId + answer to resume).'))
    const run = new BrowserRun({
      goal: args.goal,
      presets: args.presets ?? [],
      allow: args.allow ?? [],
      avoid: args.avoid ?? [],
      doneWhen: hasDoneWhen(args.done_when) ? args.done_when : undefined,
      maxSteps: args.maxSteps ?? DEFAULT_MAX_STEPS,
      maxWallMs: args.maxWallMs ?? DEFAULT_MAX_WALL_MS,
    }, depsFor(sessionId, args.tab))
    return reply(sessionId, run, await run.start(signal))
  } catch (err) {
    return browserErrorReply(err)
  }
}
