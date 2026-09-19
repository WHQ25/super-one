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
import { type PageObservation, type DoneWhen, checkDoneWhen, clickNode, hasDoneWhen, isFresh, observePage, pressEnterInNode, scrollPage, settleAfter, typeIntoNode, waitForDocumentComplete } from './browser-page'
import { getJevApiKey } from './jev-api-key'
import { type Answer, FastRun, type RunDeps, type RunResult } from './loop'
import { type PausedRun, storePausedRun, takePausedRun } from './run-store'
import { jevClient, runInputShape } from './run-tool-common'

export const BROWSER_RUN_DESCRIPTION =
  'Experimental (requires the Jev fast loop setting): pursue a multi-step page goal — clicks, typing, scrolling — with a fast model choosing each step, so you do not pay a turn per click. '
  + 'Start with goal (+ presets for values to type, done_when for a machine-checkable finish, allow/avoid for buttons). '
  + 'Risky buttons (submit, delete, pay, cross-origin links) are never pressed without asking: the call returns status=paused with a question; answer it by calling again with runId + answer. '
  + 'Use for click/fill-heavy tasks on one tab; use browser_act for single steps, drag, keys, uploads.'

export const browserRunInputShape = {
  ...runInputShape,
  tab: z.string().optional().describe('Browser view id. Omit to target the focused browser view.'),
  done_when: z.object({
    selector: z.string().optional(),
    selectorGone: z.string().optional(),
    text: z.string().optional(),
    urlIncludes: z.string().optional(),
    urlMatches: z.string().optional().describe('JavaScript regex source matched against the page URL.'),
  }).optional().describe('Machine-checkable completion condition (AND-combined, same vocabulary as browser_wait_for). Strongly recommended.'),
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


function depsFor(sessionId: string, tab: string | undefined, doneWhen?: DoneWhen): RunDeps<PageObservation> {
  let target = -1
  return {
    ask: (request, signal) => jevClient().ask(request, signal),
    resolveTarget: async () => { target = await resolveCdpTarget(sessionId, tab) },
    observe: () => observePage(target),
    isFresh: (page, node) => isFresh(target, page, node),
    click: (node) => clickNode(target, node),
    pressEnter: (node) => pressEnterInNode(target, node),
    type: (node, text) => typeIntoNode(target, node, text),
    scroll: (page, deltaY) => scrollPage(target, page, deltaY),
    settle: (opts) => settleAfter(target, opts),
    waitReady: (timeoutMs) => waitForDocumentComplete(target, timeoutMs),
    checkDone: () => doneWhen ? checkDoneWhen(target, doneWhen) : Promise.resolve(false),
    changed: (before, after) => JSON.stringify(before.marker) !== JSON.stringify(after.marker),
    focusGuard: (active) => browserFocusGuard(sessionId, active),
  }
}

function reply(sessionId: string, run: PausedRun, result: RunResult): BrowserToolReply {
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
    const run = new FastRun({
      goal: args.goal,
      presets: args.presets ?? [],
      allow: args.allow ?? [],
      avoid: args.avoid ?? [],
      hasDoneWhen: hasDoneWhen(args.done_when),
      maxSteps: args.maxSteps ?? DEFAULT_MAX_STEPS,
      maxWallMs: args.maxWallMs ?? DEFAULT_MAX_WALL_MS,
    }, depsFor(sessionId, args.tab, args.done_when))
    return reply(sessionId, run, await run.start(signal))
  } catch (err) {
    return browserErrorReply(err)
  }
}
