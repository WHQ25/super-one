/**
 * Record real Codex app-server turns as raw notification fixtures.
 *
 *   bun packages/codex/scripts/record-turns.ts [scenario ...]
 *
 * Runs in an isolated CODEX_HOME (only auth.json is copied) against a scratch
 * git repository, so it never touches a user config, session or project.
 * `CODEX_BIN` overrides the managed binary. Output: one JSON file per scenario
 * under `src/fixtures/recordings/`, with machine paths replaced by placeholders.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { openCodexAppServer, runCodexAppServerTurn, type CodexAppServerHandle, type CodexTurnKind } from '../src/app-server-client'

type Notification = { method: string; params: Record<string, unknown> }
type Turn = {
  prompt?: string
  turnKind?: CodexTurnKind
  collaborationMode?: string
  /** Send turn/interrupt this many ms after the first commandExecution starts. */
  interruptAfterCommandMs?: number
  /** Send a turn/steer with this prompt once the first commandExecution starts. */
  steer?: string
}
type Scenario = { name: string; turns: Turn[]; threadConfig?: Record<string, unknown>; before?: (repo: string) => void }

const here = dirname(new URL(import.meta.url).pathname)
const root = resolve(here, '../../..')
const outDir = join(here, '../src/fixtures/recordings')
const MODEL = process.env.CODEX_MODEL ?? 'gpt-6.1-sol'
/** Host/account notifications that carry machine identity and no turn content. */
const IGNORED_METHODS = ['configWarning', 'remoteControl/', 'account/']
const fixtureServer = join(root, 'apps/desktop/src/test/fixtures/mcp-apps/fixture-server.ts')

const scenarios: Scenario[] = [
  { name: 'commands', turns: [{ prompt: 'Run each of these shell commands as a separate tool call, in order: `cat README.md`, `rg -n TODO src`, `ls src`, `cat README.md && ls src`, `sh -c "exit 3"`. Then summarize the results in one sentence.' }] },
  { name: 'file-change', turns: [{ prompt: 'Using apply_patch: create notes.md containing three short bullet lines, then change the greeting string in src/app.ts to "Hello, recordings". Reply with one sentence when done.' }] },
  { name: 'mcp-app', turns: [{ prompt: 'Call fixture_list_items with page 1 exactly once. Do not call any other tool. Then reply with the number of items returned.' }],
    threadConfig: { mcp_servers: { fixture: { command: 'node', args: [fixtureServer, '--stdio'], startup_timeout_sec: 20 } } } },
  { name: 'web-search', turns: [{ prompt: 'Search the web for the current stable Bun release version and answer in one sentence. Use web search.' }], threadConfig: { web_search: 'live' } },
  { name: 'todo', turns: [{ prompt: 'Call the update_plan tool first with exactly three pending steps: "Read README.md", "List src", "Summarize". Then do each step with a shell command, calling update_plan after each step to mark it completed. Finish with a one-line summary.' }] },
  { name: 'plan-mode', turns: [{ prompt: 'Plan how to add a `farewell()` function to src/app.ts with a unit test. Do not edit files.', collaborationMode: 'plan' }] },
  { name: 'review', before: (repo) => writeFileSync(join(repo, 'src/app.ts'), 'export function greet(name) {\n  return "Hello, " + nam\n}\n'), turns: [{ turnKind: 'review' }] },
  { name: 'collab', turns: [{ prompt: 'Spawn exactly one subagent and ask it to count the lines of README.md with a shell command. Wait for it to finish, then send it one follow-up asking it to also count the lines of src/app.ts, wait again, and report both numbers.' }] },
  { name: 'interrupt', turns: [{ prompt: 'Run the shell command `sleep 20 && echo done` and then report its output.', interruptAfterCommandMs: 1500 }] },
  { name: 'steer', turns: [{ prompt: 'Run the shell command `sleep 6 && echo first` and report its output.', steer: 'Also run `echo second` afterwards and report both outputs.' }] },
  { name: 'compact', turns: [{ prompt: 'Read README.md with a shell command and summarize it in one sentence.' }, { turnKind: 'compact' }, { prompt: 'In one sentence, what did README.md say?' }] },
]

function seedRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'codex-rec-repo-'))
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'README.md'), '# Recording fixture\n\nA tiny project used to record Codex turns.\nTODO: nothing important.\n')
  writeFileSync(join(repo, 'src/app.ts'), 'export function greet(name: string): string {\n  // TODO: localize\n  return `Hello, ${name}`\n}\n')
  writeFileSync(join(repo, 'src/util.ts'), 'export const add = (a: number, b: number) => a + b\n')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=rec@example.com', '-c', 'user.name=rec', 'commit', '-qam', 'init', '--allow-empty'], { cwd: repo })
  execFileSync('git', ['add', '-A'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=rec@example.com', '-c', 'user.name=rec', 'commit', '-qm', 'seed'], { cwd: repo })
  return repo
}

function sanitize(value: unknown, replacements: Array<[string, string]>): unknown {
  if (typeof value === 'string') return replacements.reduce((text, [from, to]) => text.split(from).join(to), value)
  if (Array.isArray(value)) return value.map(entry => sanitize(entry, replacements))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry, replacements)]))
  return value
}

function codexBinary(): string {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN
  const current = JSON.parse(readFileSync(join(homedir(), '.superone/dev/harness/codex/current'), 'utf8')) as { installRoot: string }
  const arch = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  return join(current.installRoot, 'lib/node_modules/@openai/codex/vendor', arch, 'bin/codex')
}

async function record(scenario: Scenario, binaryPath: string, version: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'codex-rec-home-'))
  const auth = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')
  if (existsSync(auth)) copyFileSync(auth, join(home, 'auth.json'))
  const repo = seedRepo()
  scenario.before?.(repo)
  const turns: Array<{ turn: Turn; notifications: Notification[]; outcome: string }> = []
  let current: Notification[] = []
  let onCommandStarted: (() => void) | null = null
  let activeTurnId: string | null = null
  let threadId: string | null = null
  let client: CodexAppServerHandle | null = null
  try {
    client = await openCodexAppServer({
      binaryPath,
      env: { ...process.env, CODEX_HOME: home },
      cliArgs: ['-c', 'features.apps=false', '-c', 'features.remote_plugin=false'],
      onNotification: (note) => {
        if (!IGNORED_METHODS.some(prefix => note.method.startsWith(prefix))) current.push(note)
        if (note.method === 'turn/started') activeTurnId = ((note.params.turn as { id?: string }) ?? {}).id ?? activeTurnId
        if (note.method === 'thread/started') threadId ??= ((note.params.thread as { id?: string }) ?? {}).id ?? null
        if (note.method === 'item/started' && (note.params.item as { type?: string })?.type === 'commandExecution' && onCommandStarted) {
          const run = onCommandStarted
          onCommandStarted = null
          run()
        }
        return false
      },
    })
    for (const turn of scenario.turns) {
      current = []
      activeTurnId = null
      const abort = new AbortController()
      if (turn.interruptAfterCommandMs !== undefined || turn.steer) {
        onCommandStarted = () => {
          setTimeout(() => {
            if (!client || !threadId) return
            if (turn.steer) void client.request('turn/steer', { threadId, input: [{ type: 'text', text: turn.steer, text_elements: [] }], ...(activeTurnId ? { expectedTurnId: activeTurnId } : {}) }).catch(() => {})
            else void client.request('turn/interrupt', { threadId, turnId: activeTurnId }).catch(() => {})
          }, turn.interruptAfterCommandMs ?? 500)
        }
      }
      let outcome = 'completed'
      try {
        const result = await runCodexAppServerTurn({
          client,
          prompt: turn.prompt ?? '',
          cwd: repo,
          threadId,
          model: MODEL,
          reasoningEffort: 'medium',
          turnKind: turn.turnKind,
          collaborationMode: turn.collaborationMode,
          threadConfig: scenario.threadConfig,
          skipThreadSetup: scenario.turns.indexOf(turn) > 0,
          signal: AbortSignal.timeout(280_000),
        })
        threadId = result.threadId
      } catch (error) {
        outcome = error instanceof Error ? error.message : String(error)
      }
      onCommandStarted = null
      turns.push({ turn, notifications: current, outcome })
      console.log(`[${scenario.name}] turn ${turns.length}: ${outcome}, ${current.length} notifications`)
    }
  } finally {
    await client?.close()
    const replacements: Array<[string, string]> = [[repo, '/workspace'], [home, '/codex-home'], [homedir(), '/home'], [tmpdir(), '/tmp'], [userInfo().username, 'user']]
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, `${scenario.name}.json`), `${JSON.stringify(sanitize({ scenario: scenario.name, codexVersion: version, model: MODEL, turns }, replacements), null, 1)}\n`)
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
}

const binaryPath = codexBinary()
const version = execFileSync(binaryPath, ['--version'], { encoding: 'utf8' }).trim()
const wanted = new Set(process.argv.slice(2))
for (const scenario of scenarios) {
  if (wanted.size && !wanted.has(scenario.name)) continue
  await record(scenario, binaryPath, version)
}
