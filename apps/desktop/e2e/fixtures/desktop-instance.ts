import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DESKTOP_ROOT = process.cwd()

/** Unpackaged dev builds keep each `SUPERONE_INSTANCE` profile here (`src/main/index.ts`). */
export function instanceUserDataDir(name: string): string {
  return path.join(DESKTOP_ROOT, '.dev-data', `instance-${name}`)
}

/** The profile plus the instance's own dev log and event trace (`src/main/dev-run-file.ts`). */
export async function removeInstanceData(name: string): Promise<void> {
  await rm(instanceUserDataDir(name), { recursive: true, force: true })
  for (const file of [`instance-${name}-dev.log`, `instance-${name}-event-trace.db`]) {
    for (const suffix of ['', '-wal', '-shm']) await rm(path.join(DESKTOP_ROOT, file + suffix), { force: true })
  }
}

export async function getRendererWindow(app: ElectronApplication, timeoutMs = 30_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // By page: a fresh profile also briefly hosts a windowless storage-migration page.
    const win = app.windows().find((w) => w.url().includes('/index.html'))
    if (win) {
      await win.waitForLoadState('domcontentloaded')
      await win.waitForFunction(() => 'agent' in window && 'app' in window && 'environment' in window)
      return win
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`renderer window did not open within ${timeoutMs}ms`)
}

export interface DesktopInstance {
  name: string
  app: ElectronApplication
  window: Page
  userDataDir: string
}

export interface LaunchOptions {
  /** Start from an empty profile (default). Off to relaunch on the same one. */
  fresh?: boolean
  /** Files written under the profile before launch, relative to it. */
  seed?: Record<string, unknown>
  env?: Record<string, string>
}

/** Launch the built app (`out/`) on its own profile, the way `launch.spec.ts` does. */
export async function launchDesktop(name: string, options: LaunchOptions = {}): Promise<DesktopInstance> {
  const userDataDir = instanceUserDataDir(name)
  if (options.fresh !== false) await removeInstanceData(name)
  for (const [relative, content] of Object.entries(options.seed ?? {})) {
    const file = path.join(userDataDir, relative)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(content, null, 2))
  }
  const app = await electron.launch({
    args: ['.'],
    cwd: DESKTOP_ROOT,
    env: {
      ...process.env,
      SUPERONE_INSTANCE: name,
      SUPERONE_E2E: '1',
      NODE_ENV: 'development',
      ...options.env,
    } as Record<string, string>,
  })
  if (process.env.E2E_DEBUG) {
    app.process().stdout?.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
    app.process().stderr?.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  }
  const window = await getRendererWindow(app)
  return { name, app, window, userDataDir }
}

/** Main-process pid, for a crash-style kill. */
export async function mainPid(instance: DesktopInstance): Promise<number> {
  return instance.app.evaluate(() => process.pid)
}
