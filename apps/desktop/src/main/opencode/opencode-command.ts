import type { SendMessageRequest, SlashCommandInfo } from '@superone/shared/agent-types'
import type { OpenCodeRuntime } from './opencode-runtime'

export const OPEN_CODE_LOCAL_COMMANDS: SlashCommandInfo[] = [
  { name: 'init', description: 'Create or update project AGENTS.md', argumentHint: '', isSkill: false },
  { name: 'compact', description: 'Compact session context', argumentHint: '', isSkill: false },
  { name: 'share', description: 'Create a public link for this session', argumentHint: '', isSkill: false },
  { name: 'unshare', description: 'Remove public access to this session', argumentHint: '', isSkill: false },
]

const localCommandNames = new Set(OPEN_CODE_LOCAL_COMMANDS.map((command) => command.name))

export interface OpenCodeCommandInvocation {
  name: string
  arguments?: string
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
    if (content !== prefix && !/^\s/.test(content.slice(prefix.length, prefix.length + 1))) continue
    const args = content.slice(prefix.length).trimStart()
    return { name, ...(args ? { arguments: args } : {}) }
  }
  return null
}

export type OpenCodeDispatchResult =
  | { kind: 'turn' }
  | { kind: 'local'; command: 'share' | 'unshare'; content: string }

export async function dispatchOpenCodeRequest(
  runtime: OpenCodeRuntime,
  request: SendMessageRequest,
): Promise<OpenCodeDispatchResult> {
  if (request.content.trim() === '/init') {
    await runtime.init(request.model)
    return { kind: 'turn' }
  }
  if (request.content.trim() === '/compact') {
    await runtime.compact(request.model)
    return { kind: 'turn' }
  }
  if (request.content.trim() === '/share') {
    const url = await runtime.share()
    return {
      kind: 'local',
      command: 'share',
      content: `[Open shared session](${url})\n\nThis link is public.`,
    }
  }
  if (request.content.trim() === '/unshare') {
    await runtime.unshare()
    return { kind: 'local', command: 'unshare', content: 'Public access removed.' }
  }
  const command = resolveOpenCodeCommandInvocation(
    request.content,
    runtime.commands.filter((candidate) => !localCommandNames.has(candidate.name.replace(/^\//, ''))),
  )
  if (command) await runtime.command(command.name, command.arguments, request.model, request.effort, request.images, request.agent)
  else await runtime.prompt(request.content, request.model, request.effort, request.images, request.agent)
  return { kind: 'turn' }
}
