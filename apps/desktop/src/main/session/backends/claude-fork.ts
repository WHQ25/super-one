import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { forkSession as sdkForkSession } from '@anthropic-ai/claude-agent-sdk'
import type { ForkContext, ForkSource } from '../types'

/** Replicate the SDK's project-dir slug (F0 in sdk.mjs): non-alphanumeric → '-'. */
function projectSlug(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

function claudeProjectsDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'projects')
}

function resolveUpToMessageId(ctx: ForkContext): string | undefined {
  if (!ctx.forkFromMessageId) return undefined
  const msg = ctx.messages.find((m) => m.id === ctx.forkFromMessageId)
  return msg?.metadata?.forkAnchorId
}

/**
 * Fork a Claude SDK transcript and relocate the new `.jsonl` into `targetCwd`'s
 * project directory, so a plain `resume` with `cwd=targetCwd` finds it.
 *
 * The CLI's `--resume` is cwd-scoped (it does not search across project dirs),
 * and the SDK resolves the project dir from `realpath(cwd)`. So the forked file
 * — which `forkSession()` writes next to the source — must live under
 * `~/.claude/projects/<slug(realpath(targetCwd))>/`. For a local fork the
 * destination already equals the source dir, so the move is skipped. See
 * reference memory `reference-sdk-fork-session-cwd-scoped`.
 */
export async function forkClaudeTranscript(
  source: ForkSource,
  targetCwd: string,
  ctx: ForkContext,
): Promise<string> {
  const upToMessageId = resolveUpToMessageId(ctx)
  const { sessionId: newSdkId } = await sdkForkSession(
    source.providerSessionId,
    upToMessageId ? { upToMessageId } : undefined,
  )
  const projectsDir = claudeProjectsDir()
  let forkedFile: string | null = null
  for (const dir of readdirSync(projectsDir)) {
    const candidate = join(projectsDir, dir, `${newSdkId}.jsonl`)
    if (existsSync(candidate)) { forkedFile = candidate; break }
  }
  if (!forkedFile) throw new Error(`forked transcript ${newSdkId}.jsonl not found`)
  const destDir = join(projectsDir, projectSlug(realpathSync(targetCwd)))
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, `${newSdkId}.jsonl`)
  if (dest !== forkedFile) renameSync(forkedFile, dest)
  return newSdkId
}
