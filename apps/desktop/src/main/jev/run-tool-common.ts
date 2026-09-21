import { z } from 'zod'
import { readAppSettings } from '../app-settings-service'
import { getJevApiKey } from './jev-api-key'
import { createJevClient, type JevClient } from './typesafe-client'
import type { RunOptions, RunResult } from './loop'
import { runReporter } from './run-events'
import { type PausedRun, storePausedRun, takePausedRun, type RunPlatform } from './run-store'

export const runInputShape = {
  description: z.string().optional().describe("Short, human-friendly summary of the goal for the user watching, in the conversation's language."),
  goal: z.string().optional().describe('What to achieve on the current page, including when to stop. Required to start a run.'),
  presets: z.array(z.object({
    key: z.string().min(1).describe('Short name, e.g. Title.'),
    value: z.string().describe('The full text to type.'),
    field: z.string().optional().describe('Hint naming the field it belongs in, e.g. "the title textbox".'),
  })).max(20).optional().describe('Values the loop may type. Never include passwords.'),
  maxSteps: z.number().int().min(1).max(100).optional().describe('Default 30.'),
  maxWallMs: z.number().int().min(5_000).max(300_000).optional().describe('Wall-clock budget per call before pausing. Default 45000.'),
  runId: z.string().optional().describe('From a paused result. Resumes that run with `answer`.'),
  answer: z.object({
    questionId: z.string(),
    choice: z.string().optional().describe('An option key from the question, or "abort".'),
    value: z.record(z.string(), z.unknown()).optional().describe('For type=value questions: { text }; for reason=capability: { actions?: <this platform\'s *_act actions, run on snapshot.stateId>, presets?: [{ key, value, field? }] }.'),
    goal: z.string().optional().describe('Optionally revise the goal.'),
    abort: z.boolean().optional(),
  }).optional().describe('Reply to the pending question when resuming.'),
}

export function jevSettingError(): string | null {
  if (!readAppSettings().jevFastLoopEnabled) return "The 'Jev fast inner loop' is disabled. Enable it in Settings → Browser → Experimental Tools."
  if (!getJevApiKey()) return 'No Jev API key is stored. Enter one in Settings → Browser → Experimental Tools → Jev fast inner loop.'
  return null
}

let client: JevClient | null = null
let clientKey = ''

export function jevClient(): JevClient {
  const key = getJevApiKey()
  if (!client || clientKey !== key) {
    client = createJevClient({ apiKey: key })
    clientKey = key
  }
  return client
}


export function runOptions(args: z.infer<typeof commonSchema> & { done_when?: unknown }): RunOptions {
  return {
    goal: args.goal!, presets: args.presets ?? [],
    hasDoneWhen: args.done_when != null, maxSteps: args.maxSteps ?? 30, maxWallMs: args.maxWallMs ?? 45_000,
  }
}

const commonSchema = z.object(runInputShape)

export function resumeRun(sessionId: string, platform: RunPlatform, args: { runId?: string; answer?: unknown }): PausedRun | null {
  if (!args.runId) return null
  if (!args.answer) throw new Error('Resuming a run needs `answer`.')
  const run = takePausedRun(sessionId, args.runId, Date.now(), platform)
  if (typeof run === 'string') throw new Error(`Cannot resume ${platform}_run ${args.runId}: ${run}. Start a new run with goal.`)
  reportRun(sessionId, platform, run)
  return run
}

/** Report this run's actions to the chat for as long as the call is open. */
export function reportRun(sessionId: string, platform: RunPlatform, run: PausedRun): void {
  run.setReporter(runReporter(sessionId, run.runId, platform).action)
}

/**
 * What a paused result tells the caller to do with it. `progress` and the
 * pause-time picture are named here because a caller who does not know they
 * exist reads a pause as "it stopped again" — and aborts a run that has
 * already reached its goal.
 */
export const PAUSE_NEXT_HINT = (platform: RunPlatform): string =>
  `Read progress first: progress.completed lists the steps since the last pause with the ${platform}_act outcome of each (unknown means no evidence either way, not failure), and progress.goal_satisfied / still_loading are Jev's last verdicts on the current page. snapshot is the page at pause time; snapshot.image.path is a picture of it (image.relevance says how much the question depends on it) and snapshot.stateId can be acted on with ${platform}_act. A reason=capability pause means Jev judged the next step needs input the loop cannot supply (question.context.hint says what kind, context.target which element; look at the image): answer with value.actions in ${platform}_act's vocabulary against snapshot.stateId and/or value.presets for the loop to type. Then call ${platform}_run with { runId, answer: { questionId, choice | value } }; answer.abort=true hands control back.`

export function finishRun(sessionId: string, platform: RunPlatform, run: PausedRun, result: RunResult): RunResult & { next?: string } {
  runReporter(sessionId, result.runId, platform).outcome(result.status)
  if (result.status !== 'paused') return result
  storePausedRun(sessionId, run, Date.now(), platform)
  return { ...result, next: PAUSE_NEXT_HINT(platform) }
}
