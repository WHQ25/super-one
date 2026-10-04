import { execFile } from 'node:child_process'
import type { PluginModFlag, PluginModModule, PluginModReview } from '@superone/shared/agent-types'

interface ValidateFinding {
  errors?: unknown
  warnings?: unknown
  notes?: unknown
}

interface ValidateReport {
  success?: boolean
  manifest?: ValidateFinding
  contents?: ValidateFinding[]
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
/** A finding is a string or `{ message }` depending on the CLI build. */
const messages = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : typeof v?.message === 'string' ? v.message : JSON.stringify(v))) : []

/** Splits `a, b{x=1, y=2}, c` on top-level commas. */
function splitList(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ''
  for (const ch of list) {
    if (ch === '{') depth++
    if (ch === '}') depth--
    if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/**
 * Reads `claude plugin validate --json`: its hooks file notes list, per mod
 * module, `<module> hooks: …` and `<module> calls: …`.
 */
export function parsePluginValidateReport(report: unknown): PluginModReview {
  const r = (report && typeof report === 'object' ? report : {}) as ValidateReport
  const findings = [r.manifest, ...(r.contents ?? [])].filter((f): f is ValidateFinding => !!f)
  const byModule = new Map<string, PluginModModule>()
  for (const note of findings.flatMap((f) => strings(f.notes))) {
    const match = /^(.+?) (hooks|calls): (.*)$/.exec(note)
    if (!match) continue
    const [, module, kind, list] = match
    const entry = byModule.get(module!) ?? { module: module!, hooks: [], calls: [] }
    entry[kind as 'hooks' | 'calls'].push(...splitList(list!))
    byModule.set(module!, entry)
  }
  const modules = [...byModule.values()]
  const hooks = modules.flatMap((m) => m.hooks.map((h) => h.replace(/\{.*$/, '')))
  const flags: PluginModFlag[] = []
  if (hooks.some((h) => h === 'tool.check' || h === 'tool.call')) flags.push('tool-approval')
  if (hooks.includes('prompt.submit')) flags.push('prompt-submit')
  return {
    ok: r.success === true,
    modules,
    flags,
    errors: findings.flatMap((f) => messages(f.errors)),
    warnings: findings.flatMap((f) => messages(f.warnings)),
  }
}

/** Runs `claude plugin validate --json <dir>`; resolves null when the CLI cannot report. */
export function reviewPluginMods(claudeBinary: string, pluginDir: string, timeoutMs = 20_000): Promise<PluginModReview | null> {
  return new Promise((resolve) => {
    // Exit code 1 still prints the report (validation errors).
    execFile(claudeBinary, ['plugin', 'validate', '--json', pluginDir], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      try {
        resolve(parsePluginValidateReport(JSON.parse(stdout)))
      } catch {
        resolve(null)
      }
    })
  })
}
