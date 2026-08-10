/**
 * P0 spike (throwaway): verify on-demand harness runtime delivery on macOS.
 *
 * Run under the PACKAGED, hardened-runtime app so the parent process matches
 * production:
 *   ELECTRON_RUN_AS_NODE=1 dist/mac-arm64/SuperOne.app/Contents/MacOS/SuperOne \
 *     scripts/harness-spike.cjs <spikeDir>
 *
 * Checks:
 *  1. Does a file written by this process get com.apple.quarantine?
 *  2. Can a hardened-runtime parent spawn a signed binary OUTSIDE the app bundle?
 */
const { spawnSync } = require('node:child_process')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const spikeDir = process.argv[2]
if (!spikeDir) throw new Error('usage: harness-spike.cjs <spikeDir>')

const ok = (b) => (b ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m')

function xattrOf(p) {
  const r = spawnSync('xattr', ['-l', p], { encoding: 'utf8' })
  return (r.stdout || '').trim()
}

async function main() {
  console.log('parent execPath :', process.execPath)
  const sig = spawnSync('codesign', ['-dv', '--verbose=2', process.execPath], { encoding: 'utf8' })
  const flags = /flags=\S+/.exec(sig.stderr || '')
  console.log('parent codesign :', flags ? flags[0] : 'unknown')
  console.log('')

  // --- Check 1: quarantine on files this process downloads + writes ---
  mkdirSync(spikeDir, { recursive: true })
  const dlPath = join(spikeDir, 'electron-written.json')
  const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64')
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dlPath, buf)
  const attrs = xattrOf(dlPath)
  const quarantined = attrs.includes('com.apple.quarantine')
  console.log('[1] fetch+write by Electron main process')
  console.log('    bytes   :', buf.length)
  console.log('    xattr   :', attrs || '(none)')
  console.log('    result  :', ok(!quarantined), quarantined ? 'QUARANTINED — blocks execution' : 'no quarantine flag')
  console.log('')

  // --- Check 2: spawn signed binaries living outside the app bundle ---
  const targets = [
    ['claude', join(spikeDir, 'claude-out/package/claude'), ['--version']],
    ['codex', join(spikeDir, 'codex-out/package/vendor/aarch64-apple-darwin/bin/codex'), ['--version']],
    ['codex/rg', join(spikeDir, 'codex-out/package/vendor/aarch64-apple-darwin/codex-path/rg'), ['--version']],
  ]
  console.log('[2] spawn from hardened-runtime parent, binary OUTSIDE bundle')
  let allOk = true
  for (const [name, bin, args] of targets) {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60_000 })
    const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n')[0]
    const good = r.status === 0 && !r.error
    if (!good) allOk = false
    console.log(
      `    ${name.padEnd(9)} ${ok(good)} status=${r.status} ${r.error ? `err=${r.error.code || r.error.message}` : `out="${out}"`}`,
    )
  }
  console.log('')
  console.log('OVERALL:', ok(!quarantined && allOk))
}

main().catch((e) => {
  console.error('spike failed:', e)
  process.exit(1)
})
