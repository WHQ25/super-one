import { z } from 'zod'
import { readAppSettings } from '../app-settings-service'
import { getJevApiKey } from './jev-api-key'
import { createJevClient, type JevClient } from './typesafe-client'
import type { RunOptions, RunResult } from './loop'
import { type PausedRun, storePausedRun, takePausedRun, type RunPlatform } from './run-store'

export const runInputShape = {
  description: z.string().optional().describe("Short, human-friendly summary of the goal for the user watching, in the conversation's language."),
  goal: z.string().optional().describe('What to achieve on the current page, including when to stop. Required to start a run.'),
  presets: z.array(z.object({
    key: z.string().min(1).describe('Short name, e.g. Title.'),
    value: z.string().describe('The full text to type.'),
    field: z.string().optional().describe('Hint naming the field it belongs in, e.g. "the title textbox".'),
  })).max(20).optional().describe('Values the loop may type. Never include passwords.'),
  allow: z.array(z.string()).optional().describe('Button labels (substring, case-insensitive) the loop may press without asking, e.g. ["Create"]. "Enter" allows pressing Enter in any filled field (keyboard submit).'),
  avoid: z.array(z.string()).optional().describe('Element labels to remove from the page entirely.'),
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
    goal: args.goal!, presets: args.presets ?? [], allow: args.allow ?? [], avoid: args.avoid ?? [],
    hasDoneWhen: args.done_when != null, maxSteps: args.maxSteps ?? 30, maxWallMs: args.maxWallMs ?? 45_000,
  }
}

const commonSchema = z.object(runInputShape)

export function resumeRun(sessionId: string, platform: RunPlatform, args: { runId?: string; answer?: unknown }): PausedRun | null {
  if (!args.runId) return null
  if (!args.answer) throw new Error('Resuming a run needs `answer`.')
  const run = takePausedRun(sessionId, args.runId, Date.now(), platform)
  if (typeof run === 'string') throw new Error(`Cannot resume ${platform}_run ${args.runId}: ${run}. Start a new run with goal.`)
  return run
}

export function finishRun(sessionId: string, platform: RunPlatform, run: PausedRun, result: RunResult): RunResult & { next?: string } {
  if (result.status !== 'paused') return result
  storePausedRun(sessionId, run, Date.now(), platform)
  return { ...result, next: `Call ${platform}_run with { runId, answer: { questionId, choice | value } }. You may inspect with other ${platform} tools first; answer.abort=true hands control back.` }
}
