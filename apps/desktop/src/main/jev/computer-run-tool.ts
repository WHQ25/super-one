import { z } from 'zod'
import type { ComputerUseService } from '../computer-use/computer-use-service'
import { conditionSchema, parseCondition } from '../computer-use/conditions'
import { ComputerUseError } from '../computer-use/types'
import { createComputerAdapter } from './computer-page'
import { ownWindows } from './own-windows'
import { FastRun } from './loop'
import { finishRun, jevClient, resumeRun, runInputShape, runOptions, reportRun } from './run-tool-common'

export const COMPUTER_RUN_DESCRIPTION =
  'Experimental (Jev setting): pursue desktop UI goals with clicks, typing and scrolling chosen without a model turn per step. Start with app (launched in the background if it is not running) or root, and goal; no computer_apps or computer_snapshot call is needed first. If the exact sequence of buttons is already known, use computer_act with a batch instead. Example: presets=[{key:"Query",value:"cats",field:"Search"}], done_when={kind:"valueEquals",ref:"@e7",value:"cats"}. Native computer_wait_for conditions bind at run start. The loop judges each step\'s risk and the goal\'s completion itself; before anything irreversible (save, send, delete, quit, leaving the app) or when unsure it pauses with a question. Resume a pause with runId + answer. Phrase goal as the end state the window will show — a row inside a folder, a text area ending with a line, no sheet open, an icon in a corner of the icon view — since the loop reads state sentences like these off the window; prefer done_when when a condition can say it. Uses existing grants and tiers; skips secure fields. Use computer_act for single steps, drag, shortcuts or pixels.'

export const computerRunInputShape = {
  ...runInputShape,
  description: z.string().trim().min(1).max(160).describe("Short, human-friendly explanation of the goal for the user watching, in the conversation's language."),
  app: z.string().optional().describe('App name (any locale) or bundle id. Resolves the app grant and its window; an app that is not running or has no window is launched in the background and its first window awaited. Use app or root, not both.'),
  root: z.string().optional().describe('Root id from computer_snapshot/computer_apps. Omit to use the existing target.'),
  done_when: conditionSchema.optional().describe('Same conditions as computer_wait_for. Bind ref to an element in the starting snapshot, or use {kind:"newRoot",title:"Fonts"} for a new same-app window/panel. newRoot needs title and/or text; supplied filters must all match. No future ref is needed.'),
}
const schema = z.object(computerRunInputShape)

/** How long a launched app gets to show its first window before the run gives up on it. */
const LAUNCH_WINDOW_TIMEOUT_MS = 8000

/**
 * The app's window root, launching the app when it is not running or has no
 * window yet. Whether an app is running, launching it and waiting for its
 * window are host facts, not judgments: making the caller find that out with
 * computer_apps first cost a model turn per run for a question the host
 * already answers, and the tool description told it to. Launch is the
 * background one, so the user keeps their current app.
 */
export async function rootForApp(
  service: ComputerUseService,
  bundleId: string,
  signal?: AbortSignal,
  { timeoutMs = LAUNCH_WINDOW_TIMEOUT_MS, pollMs = 250 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const noWindow = (error: unknown) => error instanceof ComputerUseError && error.code === 'UNKNOWN_ROOT'
  try {
    return (await service.resolveTargetRoot(undefined, bundleId)).rootId
  } catch (error) {
    if (!noWindow(error)) throw error
  }
  signal?.throwIfAborted()
  const launched = await service.apps('launch', bundleId)
  if ('target' in launched && launched.target?.rootId) return launched.target.rootId
  const deadline = Date.now() + timeoutMs
  for (;;) {
    signal?.throwIfAborted()
    try {
      return (await service.resolveTargetRoot(undefined, bundleId)).rootId
    } catch (error) {
      if (!noWindow(error) || Date.now() >= deadline) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

export async function executeComputerRun(
  sessionId: string,
  raw: Record<string, unknown>,
  service: ComputerUseService,
  resolve: (args: { app?: string; root?: string }, signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
) {
  const args = schema.parse(raw)
  const existing = resumeRun(sessionId, 'computer', args)
  if (existing) return finishRun(sessionId, 'computer', existing, await existing.resume(args.answer!, signal))
  if (!args.goal?.trim()) throw new Error('`goal` is required to start computer_run; use runId + answer to resume.')
  if (args.app && args.root) throw new Error('Use either app or root, not both.')
  const doneWhen = parseCondition(args.done_when)
  const adapter = createComputerAdapter({
    service, root: args.root, doneWhen, sessionId, ownWindows: ownWindows(), resolve: (signal) => resolve(args, signal),
    ask: (request, signal) => jevClient().ask(request, signal),
  })
  const run = new FastRun(runOptions(args), adapter)
  reportRun(sessionId, 'computer', run)
  return finishRun(sessionId, 'computer', run, await run.start(signal))
}
