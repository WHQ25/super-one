/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startLive = vi.fn()
const stopLive = vi.fn()
let bashOutputState: { content: string; finished: boolean; outputPath?: string } | undefined

vi.mock('@/stores/chat-store/helpers/bash-output-live', () => ({
  startBashOutputLive: (...args: unknown[]) => startLive(...args),
  stopBashOutputLive: (...args: unknown[]) => stopLive(...args),
}))

vi.mock('@/stores/chat', () => ({
  useBashOutput: () => bashOutputState,
  useChatStore: Object.assign(
    (selector: (s: { activeProject: string }) => unknown) =>
      selector({ activeProject: 'remote:conn-1:/work/app' }),
    {
      getState: () => ({ activeProject: 'remote:conn-1:/work/app' }),
      setState: vi.fn(),
    },
  ),
}))

vi.stubGlobal('window', {
  app: {
    trace: vi.fn(),
    watchBashOutput: vi.fn(),
    unwatchBashOutput: vi.fn(),
    readProjectFile: vi.fn(),
    readSubagentTranscript: vi.fn(),
  },
})

const { useSubagentJsonl } = await import('./use-subagent-jsonl')

const GROK_LINE = [
  '{"type":"assistant","tool_calls":[{"id":"t1","name":"read_file","arguments":"{\\"target_file\\":\\"a.ts\\"}"}]}',
  '{"type":"tool_result","tool_call_id":"t1","content":"ok"}',
  '',
].join('\n')

describe('useSubagentJsonl remote / reload', () => {
  beforeEach(() => {
    startLive.mockReset()
    stopLive.mockReset()
    startLive.mockReturnValue(() => {})
    bashOutputState = undefined
  })

  afterEach(() => {
    stopLive.mockReset()
  })

  it('starts live watch with remote projectKey and absolute Grok transcript path', () => {
    const abs = '/Users/me/.grok/sessions/%2Fwork%2Fapp/sa1/chat_history.jsonl'
    renderHook(() =>
      useSubagentJsonl({
        toolUseId: 'tool-reload',
        outputFile: abs,
        enabled: true,
        isRunning: false,
        skipAuthoritativeRead: true,
      }),
    )
    expect(startLive).toHaveBeenCalledWith(
      expect.objectContaining({
        toolUseId: 'tool-reload',
        outputPath: abs,
        projectKey: 'remote:conn-1:/work/app',
      }),
    )
  })

  it('loads tool entries from tailed content after completed remote reload (no prior cache)', async () => {
    const abs = '/Users/me/.grok/sessions/%2Fwork%2Fapp/sa1/chat_history.jsonl'
    // First render: empty cache (post-reload). Then content arrives from offset-0 remote tail.
    const { result, rerender } = renderHook(
      (props: { content?: string }) => {
        bashOutputState = props.content
          ? { content: props.content, finished: true, outputPath: abs }
          : undefined
        return useSubagentJsonl({
          toolUseId: 'tool-done',
          outputFile: abs,
          enabled: true,
          isRunning: false,
          skipAuthoritativeRead: true,
        })
      },
      { initialProps: { content: undefined as string | undefined } },
    )

    expect(result.current.entries).toEqual([])

    await act(async () => {
      rerender({ content: GROK_LINE })
    })

    expect(result.current.entries.some((e) => e.type === 'tool' && e.toolName === 'Read')).toBe(true)
    expect(startLive).toHaveBeenCalled()
  })
})
