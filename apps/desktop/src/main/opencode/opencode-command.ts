import type { SendMessageRequest, SlashCommandInfo } from '@superone/shared/agent-types'
import type { OpenCodeRuntime } from './opencode-runtime'

import { OPEN_CODE_LOCAL_COMMANDS, resolveOpenCodeCommandInvocation } from '@superone/opencode/runtime-helpers'
export { OPEN_CODE_LOCAL_COMMANDS, resolveOpenCodeCommandInvocation, type OpenCodeCommandInvocation } from '@superone/opencode/runtime-helpers'
const localCommandNames = new Set(OPEN_CODE_LOCAL_COMMANDS.map(command => command.name))

export function resolveOpenCodeShellCommand(content: string): string | null {
  if (!content.startsWith('!')) return null
  return content.slice(1).trimStart() || null
}

export type OpenCodeDispatchResult =
  | { kind: 'turn' }
  | { kind: 'local'; command: 'share' | 'unshare'; content: string }

/**
 * `onInputAccepted` runs just before the request that hands the input to
 * OpenCode (see `SendDelivery`); validation and local share commands come first.
 */
export async function dispatchOpenCodeRequest(
  runtime: OpenCodeRuntime,
  request: SendMessageRequest,
  onInputAccepted?: () => void,
): Promise<OpenCodeDispatchResult> {
  if (request.content.startsWith('!')) {
    const shellCommand = resolveOpenCodeShellCommand(request.content)
    if (!shellCommand) throw new Error('OpenCode shell command cannot be empty')
    if (request.images?.length) throw new Error('OpenCode shell commands do not support attachments')
    onInputAccepted?.()
    await runtime.shell(shellCommand, request.model, request.agent)
    return { kind: 'turn' }
  }
  if (request.content.trim() === '/init') {
    onInputAccepted?.()
    await runtime.init(request.model)
    return { kind: 'turn' }
  }
  if (request.content.trim() === '/compact') {
    onInputAccepted?.()
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
  onInputAccepted?.()
  if (command?.skillId) await runtime.prompt(command.arguments ?? '', request.model, request.effort, request.images, request.agent, [command.skillId])
  else if (command) await runtime.command(command.name, command.arguments, request.model, request.effort, request.images, request.agent)
  else await runtime.prompt(request.content, request.model, request.effort, request.images, request.agent)
  return { kind: 'turn' }
}
