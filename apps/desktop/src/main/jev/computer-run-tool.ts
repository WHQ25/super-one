import { z } from 'zod'
import type { ComputerUseService } from '../computer-use/computer-use-service'
import { conditionSchema, parseCondition } from '../computer-use/conditions'
import { createComputerAdapter } from './computer-page'
import { FastRun } from './loop'
import { finishRun, jevClient, resumeRun, runInputShape, runOptions } from './run-tool-common'

export const COMPUTER_RUN_DESCRIPTION =
  'Experimental (Jev setting): pursue desktop UI goals with clicks, typing and scrolling chosen without a model turn per step. Start with app or root and goal. If the exact sequence of buttons is already known, use computer_act with a batch instead. Example: presets=[{key:"Query",value:"cats",field:"Search"}], done_when={kind:"valueEquals",ref:"@e7",value:"cats"}. Native computer_wait_for conditions bind at run start. The loop judges each step\'s risk and the goal\'s completion itself; before anything irreversible (save, send, delete, quit, leaving the app) or when unsure it pauses with a question. Resume a pause with runId + answer. Uses existing grants and tiers; skips secure fields. Use computer_act for single steps, drag, shortcuts or pixels.'

export const computerRunInputShape = {
  ...runInputShape,
  description: z.string().trim().min(1).max(160).describe("Short, human-friendly explanation of the goal for the user watching, in the conversation's language."),
  app: z.string().optional().describe('App name or bundle id. Resolves the existing app grant; launch it with computer_apps first if it has no window. Use app or root, not both.'),
  root: z.string().optional().describe('Root id from computer_snapshot/computer_apps. Omit to use the existing target.'),
  done_when: conditionSchema.optional().describe('Same conditions as computer_wait_for. Bind ref to an element in the starting snapshot, or use {kind:"newRoot",title:"Fonts"} for a new same-app window/panel. newRoot needs title and/or text; supplied filters must all match. No future ref is needed.'),
}
const schema = z.object(computerRunInputShape)

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
    service, root: args.root, doneWhen, resolve: (signal) => resolve(args, signal),
    ask: (request, signal) => jevClient().ask(request, signal),
  })
  const run = new FastRun(runOptions(args), adapter)
  return finishRun(sessionId, 'computer', run, await run.start(signal))
}
