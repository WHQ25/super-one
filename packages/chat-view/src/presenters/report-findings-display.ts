/** Shared normalization for review findings supplied in tool input. */
/**
 * Shape of the `ReportFindings` call, made safe to render.
 *
 * Everything worth showing lives in the tool *input* — the result is a bare
 * acknowledgement — so this module only normalizes params. The payload arrives
 * mid-stream as partially-parsed JSON and, on harnesses that stringify nested
 * arguments, with `findings` still a string; both are read as "nothing yet"
 * rather than allowed to throw.
 */

export type ReviewLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type FindingVerdict = 'CONFIRMED' | 'PLAUSIBLE'
export type FindingOutcome = 'fixed' | 'skipped' | 'no_change_needed'

const LEVELS: readonly ReviewLevel[] = ['low', 'medium', 'high', 'xhigh', 'max']
const VERDICTS: readonly FindingVerdict[] = ['CONFIRMED', 'PLAUSIBLE']
const OUTCOMES: readonly FindingOutcome[] = ['fixed', 'skipped', 'no_change_needed']

export interface ReviewFinding {
  file: string
  line?: number
  /** One sentence stating the defect. */
  summary: string
  /** Compressed label for the collapsed row; falls back to `summary`. */
  shortSummary?: string
  /** Concrete inputs/state → wrong output/crash. */
  failureScenario?: string
  category?: string
  verdict?: FindingVerdict
  /** Only present when the review re-reported after applying fixes. */
  outcome?: FindingOutcome
}

export interface ReportFindingsInfo {
  level?: ReviewLevel
  findings: ReviewFinding[]
  /** True once a complete, empty `findings` array arrived — a clean review. */
  clean: boolean
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

/** `findings` may still be a JSON string on harnesses that stringify nested args. */
function toArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

function parseFinding(raw: unknown): ReviewFinding | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const summary = str(value.summary)
  const file = str(value.file)
  // A row with neither a claim nor a location is a half-streamed object, not a finding.
  if (!summary && !file) return null
  return {
    file: file ?? '',
    line: typeof value.line === 'number' && Number.isFinite(value.line) ? value.line : undefined,
    summary: summary ?? '',
    shortSummary: str(value.short_summary),
    failureScenario: str(value.failure_scenario),
    category: str(value.category),
    verdict: oneOf(value.verdict, VERDICTS),
    outcome: oneOf(value.outcome, OUTCOMES),
  }
}

export function parseReportFindings(params: Record<string, unknown>): ReportFindingsInfo {
  const raw = toArray(params.findings)
  return {
    level: oneOf(params.level, LEVELS),
    findings: raw ? raw.map(parseFinding).filter((f): f is ReviewFinding => f !== null) : [],
    clean: !!raw && raw.length === 0,
  }
}

/** The basename the chip shows; the full path stays in its tooltip. */
export function findingFileName(file: string): string {
  const cut = file.lastIndexOf('/')
  return cut >= 0 ? file.slice(cut + 1) : file
}

/**
 * The one line a compact surface has room for.
 *
 * The list is ranked most-severe first, so the top entry is the honest single-line
 * stand-in for the whole report. A clean review still says something — an empty
 * summary would read as a row that failed to parse.
 */
export function topFindingSummary(params: Record<string, unknown>): string {
  const info = parseReportFindings(params)
  if (info.clean) return 'no findings'
  const top = info.findings[0]
  return top ? top.shortSummary || top.summary : ''
}
