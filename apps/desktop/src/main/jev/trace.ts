import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import log from '../logger'

/**
 * One JSONL line per step, per run. Threshold calibration, pause-reason
 * distribution and latency all come from here; nothing else records the full
 * probability tables. Secrets never enter: presets are logged by key only.
 */
export interface TraceStep {
  runId: string
  step: number
  at: number
  url: string
  elements: number
  textChars: number
  requestTokens?: number
  answers?: Record<string, unknown>
  model?: string
  latencyMs?: { jev?: number; act?: number; observe?: number }
  decision: Record<string, unknown>
  changedPage?: boolean | null
  stale?: boolean
}

let traceDir: string | null = null

export function setJevTraceDir(dir: string | null): void {
  traceDir = dir
}

function resolveTraceDir(): string | null {
  if (traceDir) return traceDir
  try {
    // Lazy: keeps electron out of the pure modules' import graph for tests.
    const { app } = require('electron') as typeof import('electron')
    traceDir = join(app.getPath('userData'), 'jev-traces')
  } catch {
    return null
  }
  return traceDir
}

export function appendJevTrace(entry: TraceStep): void {
  const dir = resolveTraceDir()
  if (!dir) return
  try {
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, `${entry.runId}.jsonl`), JSON.stringify(entry) + '\n')
  } catch (err) {
    log.warn('[jev] trace write failed: %s', err instanceof Error ? err.message : String(err))
  }
}
