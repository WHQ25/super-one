/**
 * Claude Agent SDK session fork — shared by desktop and node CLI.
 *
 * Relocates the forked `.jsonl` under `~/.claude/projects/<slug(realpath(targetCwd))>/`
 * so `resume` with that cwd finds the transcript (CLI resume is cwd-scoped).
 */

import { existsSync, mkdirSync, readdirSync, realpathSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { forkSession as defaultSdkForkSession } from '@anthropic-ai/claude-agent-sdk'

/** Replicate the SDK's project-dir slug (F0 in sdk.mjs): non-alphanumeric → '-'. */
export function claudeProjectSlug(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

export function claudeProjectsDir(configDir?: string): string {
  const root = configDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(root, 'projects')
}

export type SdkForkSessionFn = (
  sessionId: string,
  opts?: { upToMessageId?: string },
) => Promise<{ sessionId: string }>

export interface ForkClaudeTranscriptInput {
  /** Claude SDK / provider session id (not SuperOne session id). */
  providerSessionId: string
  /** Absolute cwd the forked session will use (project root or worktree). */
  targetCwd: string
  /**
   * SDK assistant message UUID to fork through (inclusive).
   * Omit for a full copy of the source transcript.
   */
  upToMessageId?: string
  /** Injectable SDK fork (tests). */
  forkSessionFn?: SdkForkSessionFn
  /** Override projects dir root (tests). Defaults to CLAUDE_CONFIG_DIR/projects. */
  projectsDir?: string
}

/**
 * Fork a Claude SDK transcript into a new session id and ensure the jsonl
 * lives under the target cwd's project slug directory.
 *
 * @returns New Claude SDK session id (use with resume / `claude-session:` prefix).
 */
export async function forkClaudeTranscript(input: ForkClaudeTranscriptInput): Promise<string> {
  const providerSessionId = input.providerSessionId?.trim()
  if (!providerSessionId) {
    throw new Error('Claude provider session id is required to fork')
  }
  const targetCwd = input.targetCwd?.trim()
  if (!targetCwd) {
    throw new Error('targetCwd is required to fork a Claude transcript')
  }

  const forkFn = input.forkSessionFn ?? defaultSdkForkSession
  const { sessionId: newSdkId } = await forkFn(
    providerSessionId,
    input.upToMessageId ? { upToMessageId: input.upToMessageId } : undefined,
  )
  if (!newSdkId?.trim()) {
    throw new Error('Claude forkSession did not return a session id')
  }

  const projectsDir = input.projectsDir ?? claudeProjectsDir()
  if (!existsSync(projectsDir)) {
    throw new Error(`Claude projects dir not found: ${projectsDir}`)
  }

  let forkedFile: string | null = null
  for (const dir of readdirSync(projectsDir)) {
    const candidate = join(projectsDir, dir, `${newSdkId}.jsonl`)
    if (existsSync(candidate)) {
      forkedFile = candidate
      break
    }
  }
  if (!forkedFile) {
    throw new Error(`forked transcript ${newSdkId}.jsonl not found under ${projectsDir}`)
  }

  const destDir = join(projectsDir, claudeProjectSlug(realpathSync(targetCwd)))
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, `${newSdkId}.jsonl`)
  if (dest !== forkedFile) {
    renameSync(forkedFile, dest)
  }
  return newSdkId
}
