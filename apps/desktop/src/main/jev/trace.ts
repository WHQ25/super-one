import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import log from '../logger'
import type { Preset } from './questions'
import type { JevAnswer } from './typesafe-client'

/**
 * One JSONL line per step, per run. Threshold calibration, pause-reason
 * distribution and latency all come from here; nothing else records the full
 * probability tables and the state behind each decision. Preset text is redacted.
 */
export interface TraceStep {
  runId: string
  platform?: 'browser' | 'computer' | 'device'
  step: number
  at: number
  url: string
  elements: number
  textChars: number
  requestTokens?: number
  usage?: { input_tokens?: number; output_tokens?: number }
  state?: unknown
  topChoices?: Record<string, Array<{ choice: string; probability: number }>>
  answers?: Record<string, unknown>
  model?: string
  latencyMs?: { jev?: number; act?: number; observe?: number }
  decision: Record<string, unknown>
  changedPage?: boolean | null
  stale?: boolean
}

/** Preserve UI evidence while keeping preset values (including their hints) out. */
export function traceRequestState(state: unknown, presets: readonly Preset[]): unknown {
  const secrets = [...new Set(presets.flatMap((preset) => [preset.value, preset.value.slice(0, 120), preset.value.slice(0, 80)]))]
    .filter(Boolean).sort((a, b) => b.length - a.length)
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join('<redacted>'), value)
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redact(child)]))
    return value
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return redact(state)
  const { presets: _hints, ...rest } = state as Record<string, unknown>
  return {
    ...redact(rest) as Record<string, unknown>,
    ...(presets.length ? { presets: presets.map(({ key, field }) => ({ key, ...(field ? { field } : {}), value: '<redacted>' })) } : {}),
  }
}

export function topChoiceProbabilities(answers: Record<string, JevAnswer>): NonNullable<TraceStep['topChoices']> {
  return Object.fromEntries(Object.entries(answers).flatMap(([key, answer]) => answer?.type === 'choice'
    ? [[key, Object.entries(answer.probabilities ?? {}).filter(([, probability]) => Number.isFinite(probability))
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([choice, probability]) => ({ choice, probability }))]]
    : []))
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
