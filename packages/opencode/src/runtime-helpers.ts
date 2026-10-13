import type { ContextUsageInfo, ImageAttachment, ModelOption, SlashCommandInfo } from '@superone/shared/agent-types'
import { attachmentPrompt, buildAttachmentTurn } from '@superone/shared/attachment-turn'
import { validateTurnAttachments } from '@superone/shared/attachment-validation'
import type { OpenCodeServerHandle } from './server'
export { OpenCodeApiError } from './client-common'
export { parseOpenCodeModelSlug } from './parse'

interface OpenCodeTokenUsage {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
  total?: number
}

export function buildOpenCodeContextUsage(
  tokens: OpenCodeTokenUsage,
  model: string,
  models: ModelOption[],
): ContextUsageInfo | null {
  const maxTokens = models.find((candidate) => candidate.id === model)?.contextWindow
  if (!maxTokens) return null
  const categories = [
    { name: 'Input', tokens: tokens.input, color: '#22c55e' },
    { name: 'Output', tokens: tokens.output, color: '#06b6d4' },
    { name: 'Reasoning', tokens: tokens.reasoning, color: '#8b5cf6' },
    { name: 'Cache read', tokens: tokens.cache.read, color: '#6366f1' },
    { name: 'Cache write', tokens: tokens.cache.write, color: '#f59e0b' },
  ]
  const totalTokens = tokens.total ?? categories.reduce((total, category) => total + category.tokens, 0)
  return {
    categories,
    totalTokens,
    maxTokens,
    percentage: Math.min(100, (totalTokens / maxTokens) * 100),
    model,
  }
}

/** Validated prompt text plus the images OpenCode receives inline. */
export function openCodeAttachmentTurn(
  images: ImageAttachment[] | undefined,
  text: string,
  requirePaths = true,
): { text: string; images: Array<{ mimeType: string; name: string; base64: string }> } {
  validateTurnAttachments(images, text)
  const turn = buildAttachmentTurn(images, { inlineImages: true, requirePaths })
  return { text: attachmentPrompt(text, turn.note), images: turn.attachments.filter((a) => a.inline) }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    const body = value.error ?? value.data ?? value.body
    if (body !== undefined) {
      try {
        return JSON.stringify(body)
      } catch {}
    }
  }
  return String(error)
}

export async function closeServer(server: OpenCodeServerHandle): Promise<void> {
  await server.close().catch(() => undefined)
}

export function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('OpenCode runtime initialization aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new Error('OpenCode runtime initialization aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export const OPEN_CODE_LOCAL_COMMANDS: SlashCommandInfo[] = [
  { name: 'init', description: 'Create or update project AGENTS.md', argumentHint: '', isSkill: false },
  { name: 'compact', description: 'Compact session context', argumentHint: '', isSkill: false },
  { name: 'share', description: 'Create a public link for this session', argumentHint: '', isSkill: false },
  { name: 'unshare', description: 'Remove public access to this session', argumentHint: '', isSkill: false },
]

export interface OpenCodeCommandInvocation {
  name: string
  arguments?: string
  skillId?: string
}

export function resolveOpenCodeCommandInvocation(
  content: string,
  commands: SlashCommandInfo[],
): OpenCodeCommandInvocation | null {
  if (!content.startsWith('/')) return null
  const ordered = [...commands].sort((a, b) => b.name.length - a.name.length)
  for (const command of ordered) {
    const name = command.name.replace(/^\//, '').trim()
    if (!name) continue
    const prefix = `/${name}`
    if (!content.startsWith(prefix)) continue
    if (content !== prefix && !/^\s/.test(content.slice(prefix.length, prefix.length + 1))) continue
    const args = content.slice(prefix.length).trimStart()
    return {
      name,
      ...(args ? { arguments: args } : {}),
      ...(command.isSkill && command.skillId ? { skillId: command.skillId } : {}),
    }
  }
  return null
}

export function withOpenCodeLocalCommands(commands: SlashCommandInfo[]): SlashCommandInfo[] {
  const seen = new Set(commands.map((command) => command.name.replace(/^\//, '')))
  return [...commands, ...OPEN_CODE_LOCAL_COMMANDS.filter((command) => !seen.has(command.name))]
}
