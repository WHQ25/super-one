import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { toolDetail } from '@superone/runtime/stream/delivery/progressive-tools'
import {
  configureRemoteContent,
  remoteContentPorts,
  resetRemoteContentPortsForTests,
} from '@superone/runtime/stream/delivery/remote-content'
import { installNodeAgentOutput } from './remote-content'

const dirs: string[] = []
afterEach(() => {
  resetRemoteContentPortsForTests()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function assistant(content: ChatMessage['content']): ChatMessage {
  return { id: 'm', role: 'assistant', content, status: 'complete', createdAt: '', providerId: 'acp' }
}

describe('installNodeAgentOutput', () => {
  it('fills an expanded Grok subagent from the child transcript and hides search_tool', () => {
    resetRemoteContentPortsForTests()
    expect(installNodeAgentOutput()).toBe(true)
    const dir = mkdtempSync(join(tmpdir(), 'node-agent-output-'))
    dirs.push(dir)
    const file = join(dir, 'chat_history.jsonl')
    writeFileSync(file, [
      JSON.stringify({
        type: 'assistant',
        tool_calls: [
          { name: 'grep', arguments: JSON.stringify({ pattern: 'session', path: '/proj' }) },
          { name: 'read_file', arguments: JSON.stringify({ target_file: '/proj/a.ts' }) },
          { name: 'search_tool', arguments: JSON.stringify({ query: 'session' }) },
        ],
      }),
      JSON.stringify({ type: 'assistant', content: 'Found 3 local-only gaps.' }),
    ].join('\n'))
    const detail = JSON.parse(toolDetail(assistant([{
      type: 'tool_use',
      toolName: 'Agent',
      toolUseId: 'spawn',
      input: '{}',
      status: 'complete',
      taskOutputFile: file,
    }]), 'spawn')) as { childBlocks: Array<Record<string, unknown>> }
    expect(detail.childBlocks).toEqual([
      { type: 'tool_use', toolName: 'Grep', toolUseId: 'spawn:transcript:0', input: '{}', status: 'complete', toolSummary: 'session in /proj', parentToolUseId: 'spawn' },
      { type: 'tool_use', toolName: 'Read', toolUseId: 'spawn:transcript:1', input: '{}', status: 'complete', toolSummary: '/proj/a.ts', parentToolUseId: 'spawn' },
    ])
    expect(JSON.stringify(detail)).not.toContain('chat_history')
  })

  it('leaves ports that were already installed', () => {
    configureRemoteContent({
      highlightCodeSync: () => [[['desktop', null]]],
      highlightCodeByLang: () => null,
      parseAnsiTokens: () => [[['plain', null]]],
      withAttachmentPreviews: (message) => message,
      readAgentOutput: () => ({ toolEntries: [{ toolName: 'Kept', description: 'desktop' }] }),
      listWorkflowAgents: () => [{ label: 'desktop', toolCount: 1 }],
    })
    expect(installNodeAgentOutput()).toBe(false)
    expect(remoteContentPorts().readAgentOutput('/tmp/missing').toolEntries).toEqual([
      { toolName: 'Kept', description: 'desktop' },
    ])
    expect(remoteContentPorts().parseAnsiTokens('x')).toEqual([[['plain', null]]])
  })

  it('highlights ANSI, lists workflow agents and shrinks a PNG', () => {
    resetRemoteContentPortsForTests()
    expect(installNodeAgentOutput()).toBe(true)
    expect(remoteContentPorts().parseAnsiTokens('\x1b[31mred')).toEqual([[['red', '#ff7b72']]])

    const dir = mkdtempSync(join(tmpdir(), 'node-workflow-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'agent-a.jsonl'), JSON.stringify({
      type: 'user',
      message: { content: 'Look at the logs' },
    }))
    expect(remoteContentPorts().listWorkflowAgents(dir)).toEqual([
      { label: 'Look at the logs', toolCount: 0, tokens: undefined },
    ])

    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const message = assistant([])
    message.attachments = [{ id: 'pic', name: 'dot.png', mimeType: 'image/png', base64: png }]
    const shrunk = remoteContentPorts().withAttachmentPreviews(message)
    expect(shrunk.attachments?.[0]).toMatchObject({ mimeType: 'image/jpeg', preview: true })
    expect(shrunk.attachments?.[0]?.base64.length).toBeGreaterThan(0)
    expect(shrunk.attachments?.[0]?.base64).not.toBe(png)
  })
})
