import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OFFICIAL_CLAUDE_SDK_VERSION, OFFICIAL_CODEX_NPM_VERSION } from './managed-official'

/**
 * The managed pins and the workspace dependencies are two copies of one fact.
 * The packaged desktop and the CLI bundle only the SDK's JS half and install
 * the native binary from the pin, so a dependency bump that forgets the pin
 * ships a JS layer talking to an older binary — and nothing else fails.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

function dependency(pkgPath: string, name: string): string | undefined {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, pkgPath), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  return pkg.dependencies?.[name]
}

describe('managed harness pins track the workspace dependencies', () => {
  it('Claude: OFFICIAL_CLAUDE_SDK_VERSION equals the SDK the harness package and apps compile against', () => {
    for (const pkgPath of ['packages/claude/package.json', 'apps/desktop/package.json', 'apps/cli/package.json']) {
      expect(dependency(pkgPath, '@anthropic-ai/claude-agent-sdk'), pkgPath).toBe(OFFICIAL_CLAUDE_SDK_VERSION)
    }
  })

  it('Codex: OFFICIAL_CODEX_NPM_VERSION equals the desktop-bundled @openai/codex', () => {
    expect(dependency('apps/desktop/package.json', '@openai/codex')).toBe(OFFICIAL_CODEX_NPM_VERSION)
  })
})
