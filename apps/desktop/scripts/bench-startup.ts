/**
 * Cold-start baseline: launches the app repeatedly against a seeded profile and
 * reports when each startup milestone lands, in ms since process launch.
 *
 *   bun run build && node scripts/bench-startup.ts [--runs 10] [--app <binary>] [--project <dir>] [--json <file>]
 *
 * Targets the unpackaged `out/` build by default: a quick inner loop, but main
 * runs its dev branches (event trace, repo-local helpers) and the MCP socket path
 * under `.dev-data/instance-*` exceeds the macOS limit. Pass `--app` with a
 * packaged binary (`bun run build:mac-dev`) for the baseline of record.
 * The OS file cache stays warm: this is a process cold start, not a cold disk.
 * Milestones come from `@superone/shared/startup-marks`.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { cpus } from 'node:os'
import { parseArgs } from 'node:util'
import { CURRENT_ONBOARDING_EPOCH } from '@superone/shared/onboarding'
import { STARTUP_MARK_PREFIX } from '@superone/shared/startup-marks'

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '10' },
    app: { type: 'string' },
    project: { type: 'string', default: resolve(process.cwd(), '../..') },
    json: { type: 'string' },
  },
})

const RUNS = Number(args.runs)
const INSTANCE = 'bench-startup'
const READY_MARK = `${STARTUP_MARK_PREFIX}composer-ready`
const RUN_TIMEOUT_MS = 60_000

/** Display order; each run must reach every milestone. */
const MILESTONES = [
  'node-env',
  'main-evaluated',
  'app-ready',
  'window-created',
  'renderer-navigation',
  'renderer-evaluated',
  'react-render',
  'first-contentful-paint',
  'composer-ready',
] as const
type Milestone = (typeof MILESTONES)[number]
type Timeline = Record<Milestone, number>

interface ProcessTiming {
  origin: number
  marks: Record<string, number>
  fcp?: number
}

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    ...(args.app ? { executablePath: args.app, args: [] } : { args: ['.'] }),
    cwd: process.cwd(),
    env: { ...process.env, SUPERONE_INSTANCE: INSTANCE, SUPERONE_E2E: '1' },
    timeout: RUN_TIMEOUT_MS,
  })
}

/** The full-app window: not DevTools and not a `?mode=` auxiliary window. */
async function mainWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + RUN_TIMEOUT_MS
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => !w.url().startsWith('devtools://') && !w.url().includes('mode='))
    if (win) return win
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('main window did not open')
}

/**
 * Fresh profile shaped like a returning user: past onboarding, Claude enabled
 * (otherwise the composer is replaced by a read-only notice), one project open,
 * and a warm model catalog. A cold catalog makes every run fire a billed
 * CONNECT_CLAUDE probe that the run closes before it can cache.
 */
async function prepareProfile(): Promise<string> {
  let app = await launch()
  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  await app.close()
  rmSync(userData, { recursive: true, force: true })

  app = await launch()
  const models = await (await mainWindow(app)).evaluate(async () => {
    const api = (window as unknown as { app: {
      enableHarness(input: { harnessId: string }): Promise<unknown>
      connectClaude(): Promise<{ models: unknown[] }>
    } }).app
    await api.enableHarness({ harnessId: 'claude' })
    return (await api.connectClaude()).models.length
  })
  console.log(`claude catalog: ${models} models`)
  await app.close()

  const settingsPath = join(userData, 'app-settings.json')
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
  writeFileSync(settingsPath, JSON.stringify({
    ...settings,
    onboardingEpoch: CURRENT_ONBOARDING_EPOCH,
    onboardingCompletedAt: Date.now(),
  }, null, 2))

  const db = new DatabaseSync(join(userData, 'superone.db'))
  db.prepare('INSERT OR IGNORE INTO projects (id, path, name, added_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), args.project!, basename(args.project!), new Date().toISOString())
  db.close()
  return userData
}

async function measureOnce(): Promise<Timeline> {
  const launchedAt = performance.timeOrigin + performance.now()
  const app = await launch()
  try {
    const page = await mainWindow(app)
    try {
      await page.waitForFunction((name) => performance.getEntriesByName(name).length > 0, READY_MARK, {
        timeout: RUN_TIMEOUT_MS,
      })
    } catch (err) {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '')
      throw new Error(`composer never became ready; screen text: ${JSON.stringify(text)}`, { cause: err })
    }

    const main: ProcessTiming = await app.evaluate((_electron, prefix) => ({
      origin: performance.timeOrigin,
      marks: Object.fromEntries(performance.getEntriesByType('mark')
        .filter((m) => m.name.startsWith(prefix))
        .map((m) => [m.name.slice(prefix.length), m.startTime])),
    }), STARTUP_MARK_PREFIX)
    const renderer: ProcessTiming = await page.evaluate((prefix) => ({
      origin: performance.timeOrigin,
      marks: Object.fromEntries(performance.getEntriesByType('mark')
        .filter((m) => m.name.startsWith(prefix))
        .map((m) => [m.name.slice(prefix.length), m.startTime])),
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
    }), STARTUP_MARK_PREFIX)

    const at = (t: ProcessTiming, offset: number | undefined): number => {
      if (offset === undefined) throw new Error(`missing milestone in ${JSON.stringify(t)}`)
      return t.origin + offset - launchedAt
    }
    return {
      'node-env': at(main, 0),
      'main-evaluated': at(main, main.marks['main-evaluated']),
      'app-ready': at(main, main.marks['app-ready']),
      'window-created': at(main, main.marks['window-created']),
      'renderer-navigation': at(renderer, 0),
      'renderer-evaluated': at(renderer, renderer.marks['renderer-evaluated']),
      'react-render': at(renderer, renderer.marks['react-render']),
      'first-contentful-paint': at(renderer, renderer.fcp),
      'composer-ready': at(renderer, renderer.marks['composer-ready']),
    }
  } finally {
    await app.close()
  }
}

/** Nearest-rank percentile. */
function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]
}

function report(runs: Timeline[]): void {
  const ms = (n: number): string => Math.round(n).toString()
  console.log(`\n# Cold start — ${args.app ? 'packaged' : 'unpackaged out/'} — ${runs.length} runs — ${cpus()[0].model}\n`)
  console.log('| Milestone | Δ phase p50 | p50 | p75 | min | max |')
  console.log('|---|---:|---:|---:|---:|---:|')
  MILESTONES.forEach((m, i) => {
    const values = runs.map((r) => r[m])
    const deltas = runs.map((r) => r[m] - (i === 0 ? 0 : r[MILESTONES[i - 1]]))
    console.log(`| ${m} | ${ms(percentile(deltas, 50))} | ${ms(percentile(values, 50))} | ${ms(percentile(values, 75))} | ${ms(Math.min(...values))} | ${ms(Math.max(...values))} |`)
  })
}

const userData = await prepareProfile()
console.log(`profile: ${userData}\nproject: ${args.project}`)
await measureOnce() // warm-up: first launch after seeding pays one-off cache and migration costs

const runs: Timeline[] = []
for (let i = 0; i < RUNS; i++) {
  const run = await measureOnce()
  runs.push(run)
  console.log(`run ${i + 1}/${RUNS}: composer-ready ${Math.round(run['composer-ready'])}ms`)
}
report(runs)
if (args.json) writeFileSync(args.json, JSON.stringify({ target: args.app ?? 'out', runs }, null, 2))
