import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { stripMessagesForRemote } from './remote-content'
import { projectProgressiveMessage } from './remote/progressive-session'

describe('remote Bash edit projection', () => {
  it('keeps the compact diff through the mobile snapshot conversion', () => {
    const message: ChatMessage = {
      id: 'm', role: 'assistant', providerId: 'claude', status: 'complete', createdAt: '',
      content: [
        { type: 'tool_use', toolName: 'Bash', toolUseId: 'b', input: '{"command":"printf hello > a.ts"}', status: 'complete' },
        { type: 'tool_result', toolUseId: 'b', summary: 'ok', bashEditDiff: {
          files: [{ filePath: '/p/a.ts', created: true, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+hello'] }] }],
          moreFiles: 0,
        } },
      ],
    }
    const [projected] = stripMessagesForRemote([projectProgressiveMessage(message)])
    const result = projected.content.find(block => block.type === 'bash_result')
    expect(result).toMatchObject({
      type: 'bash_result', toolUseId: 'b', bashEditDiff: {
        changedFiles: ['/p/a.ts'],
        summary: { files: 1, added: 1, removed: 0, approximate: false },
        fileChanges: [{ path: '/p/a.ts', added: 1, removed: 0 }],
      },
    })
    expect(JSON.stringify(projected)).not.toContain('+hello')
  })
})
