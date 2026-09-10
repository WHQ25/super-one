import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CodexCommandExecutionItem } from '@superone/shared/agent-types'
import { initializeChatViewI18n } from './i18n'
import { PortableMessage } from './PortableMessage'

beforeAll(() => initializeChatViewI18n('en'))

describe.each([false, true])('Codex command outcomes (deferred: %s)', (deferred) => {
  function render(item: Partial<CodexCommandExecutionItem>) {
    return renderToStaticMarkup(createElement(PortableMessage, {
      scheme: 'dark', pendingPermission: null, isLastAssistant: true, sessionStreaming: false,
      message: {
        id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
        metadata: { codex: { threadId: 'thread', usage: null, items: [{
          id: 'command', type: 'command_execution', command: 'rg missing README.md',
          aggregatedOutput: '', status: 'failed', ...item,
          ...(deferred ? { remoteDetail: '["turn","item","command"]' } : {}),
        }] } },
      },
    }))
  }

  it.each([0, 1, 2, 127])('renders process exit %s without a tool error', (exitCode) => {
    const html = render({ exitCode })
    expect(html).toContain('rg missing README.md')
    expect(html).not.toContain('errored')
  })

  it('renders failure to execute the tool as an error', () => {
    expect(render({ aggregatedOutput: 'Unable to start process' })).toContain('errored')
  })
})
