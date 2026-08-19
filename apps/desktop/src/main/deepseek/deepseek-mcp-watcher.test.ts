/**
 * The watch exists so an edit to dsh's own config file reaches a running tree.
 * Its failure modes are all filesystem-shaped — a rename-based save losing the
 * inode, a burst of events causing a burst of resyncs, a missing profile
 * directory silencing the feature — so these drive the real fs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { getDshPatchPath } from '@superone/runtime/fs'
import { watchDshMcpConfig } from './deepseek-mcp-watcher'

const dirs: string[] = []
const stops: Array<() => void> = []
const SETTLE_MS = 20

function dshHome(): { dshHome: string; settleMs: number } {
  const home = mkdtempSync(join(tmpdir(), 'dsh-watch-'))
  dirs.push(home)
  return { dshHome: home, settleMs: SETTLE_MS }
}

/**
 * `fs.watch` returns before the platform watch is necessarily live — on macOS
 * the FSEvents stream starts asynchronously — so a write issued in the same
 * tick can be missed. Production never races this (the watch is armed at
 * session start and the user edits much later), but a test does.
 */
async function arm(opts: { dshHome: string; settleMs: number }) {
  const onChange = vi.fn()
  const stop = watchDshMcpConfig(onChange, opts)
  stops.push(stop)
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 2))
  return { onChange, stop }
}

/**
 * Wait for the watch to fire, polling rather than sleeping a fixed span.
 *
 * A fixed wait made these tests hostage to FSEvents latency: the debounce is
 * bounded but the delivery before it is not, so a loaded machine failed a
 * watch that works.
 */
async function fires(onChange: { mock: { calls: unknown[] } }): Promise<void> {
  const deadline = Date.now() + 2000
  while (onChange.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  }
}

/** For the negative assertions, where only elapsed time can prove a silence. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 10))
}

afterEach(() => {
  while (stops.length) stops.pop()?.()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('dsh MCP config watch', () => {
  it('fires when the patch file is written', async () => {
    const opts = dshHome()
    const { onChange } = await arm(opts)

    writeFileSync(getDshPatchPath(opts), '[]\n')
    await fires(onChange)

    expect(onChange).toHaveBeenCalled()
  })

  // vim, VS Code and friends save by writing a temp file and renaming over the
  // target. A watch on the file itself would keep following the replaced inode.
  it('survives an editor saving by atomic rename', async () => {
    const opts = dshHome()
    const filePath = getDshPatchPath(opts)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, '[]\n')
    const { onChange } = await arm(opts)

    const temp = `${filePath}.tmp`
    writeFileSync(temp, '- id: mcp-a\n')
    renameSync(temp, filePath)
    await fires(onChange)

    expect(onChange).toHaveBeenCalled()
  })

  it('coalesces a burst of writes into one resync', async () => {
    const opts = dshHome()
    const { onChange } = await arm(opts)
    const filePath = getDshPatchPath(opts)

    for (let i = 0; i < 5; i++) writeFileSync(filePath, `# ${i}\n[]\n`)
    await fires(onChange)
    // The debounce window has to close before the count is meaningful.
    await settled()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('ignores writes to a sibling file', async () => {
    const opts = dshHome()
    const filePath = getDshPatchPath(opts)
    mkdirSync(dirname(filePath), { recursive: true })
    const { onChange } = await arm(opts)

    writeFileSync(join(dirname(filePath), 'cordis.yml'), '[]\n')
    await settled()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('stops firing once unsubscribed', async () => {
    const opts = dshHome()
    const { onChange, stop } = await arm(opts)

    stop()
    writeFileSync(getDshPatchPath(opts), '[]\n')
    await settled()

    expect(onChange).not.toHaveBeenCalled()
  })

  // dsh may never have run. The directory is the one `saveDshMcpConfig` creates
  // on first write, so arming has to work before it exists — otherwise adding
  // your first server would be exactly the edit that goes unnoticed.
  it('arms before the profile directory exists', async () => {
    const opts = dshHome()
    rmSync(opts.dshHome, { recursive: true, force: true })
    const { onChange } = await arm(opts)

    writeFileSync(getDshPatchPath(opts), '[]\n')
    await fires(onChange)

    expect(onChange).toHaveBeenCalled()
  })
})
