import type { SendMessageRequest, SlashCommandInfo } from '@superone/shared/agent-types'
import type { OpenCodeRuntime } from './opencode-runtime'

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

export async function dispatchOpenCodeRequest(runtime: OpenCodeRuntime, request: SendMessageRequest): Promise<void> {
  if (request.content.trim() === '/init') {
    await runtime.init(request.model)
    return
  }
  if (request.content.trim() === '/compact') {
    await runtime.compact(request.model)
    return
  }
  const command = resolveOpenCodeCommandInvocation(
    request.content,
    runtime.commands.filter((candidate) => !['init', 'compact'].includes(candidate.name.replace(/^\//, ''))),
  )
  if (command) await runtime.command(command.name, command.arguments, request.model, request.effort, request.images, request.agent)
  else await runtime.prompt(request.content, request.model, request.effort, request.images, request.agent)
}
