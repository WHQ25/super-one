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
const { parseJsonlOutput } = await import('./subagent-utils')

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

  it('parses Antigravity subagent transcript.jsonl with thinking, generate_image, and send_message', () => {
    const agyRaw = [
      JSON.stringify({
        step_index: 4,
        type: 'USER_INPUT',
        status: 'DONE',
        content: 'Generate a minimalist neon cat icon.',
      }),
      JSON.stringify({
        step_index: 6,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        thinking: 'Creating neon cat icon now.',
        tool_calls: [
          {
            id: 'img_1',
            name: 'generate_image',
            args: {
              ImageName: '"neon_cat"',
              Prompt: '"Minimalist neon cat icon"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 7,
        type: 'GENERIC',
        status: 'DONE',
        content:
          'Created At: 2026-11-08T11:59:00+08:00\nCompleted At: 2026-11-08T11:59:18+08:00\n\nGenerated image is saved at /tmp/neon_cat.jpg.',
        media: [{ mime_type: 'image/jpeg', uri: '/tmp/neon_cat.jpg' }],
      }),
      JSON.stringify({
        step_index: 8,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [
          {
            id: 'msg_1',
            name: 'send_message',
            args: {
              Message: '"Saved to /tmp/neon_cat.jpg"',
              Recipient: '"parent-id"',
            },
          },
        ],
      }),
      JSON.stringify({
        step_index: 9,
        type: 'GENERIC',
        status: 'DONE',
        content: 'Message sent.',
      }),
    ].join('\n')

    const parsed = parseJsonlOutput(agyRaw)
    expect(parsed.entries.some((e) => e.type === 'activity' && e.text.includes('Creating neon cat icon'))).toBe(true)
    expect(
      parsed.entries.some(
        (e) =>
          e.type === 'tool' &&
          e.toolName === 'ImageGen' &&
          e.input?.includes('"prompt":"Minimalist neon cat icon"') &&
          e.result?.includes('/tmp/neon_cat.jpg'),
      ),
    ).toBe(true)
    expect(
      parsed.entries.some(
        (e) =>
          e.type === 'tool' &&
          e.toolName === 'SendMessage' &&
          e.input?.includes('"message":"Saved to /tmp/neon_cat.jpg"'),
      ),
    ).toBe(true)
    expect(parsed.resultText).toBe('Saved to /tmp/neon_cat.jpg')

    const inProgressAgyRaw = [
      JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [{ id: 'tc-1', name: 'read_file', args: { Path: '/tmp/a.ts' } }],
      }),
      JSON.stringify({
        step_index: 2,
        type: 'GENERIC',
        status: 'DONE',
        content: '',
      }),
      JSON.stringify({
        step_index: 3,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        tool_calls: [{ id: 'tc-2', name: 'read_file', args: { Path: '/tmp/b.ts' } }],
      }),
    ].join('\n')
    const inProgressParsed = parseJsonlOutput(inProgressAgyRaw)
    const toolEntries = inProgressParsed.entries.filter((e) => e.type === 'tool')
    expect(toolEntries).toHaveLength(2)
    expect(toolEntries[0].completed).toBe(true)
    expect(toolEntries[1].completed).toBeUndefined()
  })

  it('parses Antigravity workflow child transcript with INVALID tool error and finish result', () => {
    const wfChildRaw = [
      JSON.stringify({
        step_index: 0,
        source: 'USER_EXPLICIT',
        type: 'USER_INPUT',
        status: 'DONE',
        content: '<USER_REQUEST>\nUppercase Hello\n</USER_REQUEST>',
      }),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 16339,
        cache_read_tokens: 0,
        output_tokens: 31,
        thinking: 'Checking tool availability.',
        tool_calls: [{ name: 'session_rename', args: { tags: '["demo"]', title: '"Demo"' } }],
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'GENERIC',
        status: 'INVALID',
        error: 'unknown tool: "session_rename" — check spelling',
        content: 'Created At: 2026-11-26T08:14:32Z\nError invalid tool call: unknown tool',
      }),
      JSON.stringify({
        step_index: 3,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        input_tokens: 2179,
        cache_read_tokens: 14223,
        output_tokens: 46,
        tool_calls: [{ name: 'finish', args: { result: '"HELLO"' } }],
      }),
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        type: 'GENERIC',
        status: 'DONE',
        content: 'Finished.',
      }),
    ].join('\n')

    const parsed = parseJsonlOutput(wfChildRaw)
    expect(parsed.entries.some((e) => e.type === 'activity' && e.text === 'Checking tool availability.')).toBe(true)
    const tools = parsed.entries.filter((e) => e.type === 'tool')
    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({
      isError: true,
      completed: true,
    })
    expect(tools[0].result).toContain('Error invalid tool call')
    expect(tools[1]).toMatchObject({
      toolName: 'Finish',
      completed: true,
    })
    expect(parsed.resultText).toBe('HELLO')
  })
})
