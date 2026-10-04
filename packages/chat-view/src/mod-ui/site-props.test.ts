import { describe, expect, it } from 'vitest'
import type { ModElement } from '@superone/shared/mod-ui'
import {
  askUserQuestionProps,
  assistantMessageProps,
  commandOutputProps,
  promptHintProps,
  promptHintText,
  sessionModeProps,
  spinnerProps,
  toolGroupProps,
  toolResultProps,
  toolUseProps,
  userMessageProps,
} from './site-props'

// The CLI hands host props to hooks unchecked (Claude contracts, "Host props are not validated"): each builder must carry
// exactly the keys its site declares in `RenderPropsOf` (claude-code 2.1.287).
const keys = (o: object) => Object.keys(o).sort()
const call = { toolUseId: 'toolu_1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false, output: 'a\nb' }

describe('mod site props', () => {
  it('UserMessage', () => {
    expect(userMessageProps('hi')).toEqual({ text: 'hi', origin: { kind: 'sdk' }, isExpanded: true })
  })
  it('AssistantMessage', () => {
    expect(keys(assistantMessageProps('t', true))).toEqual(['isFirstOfReply', 'text'])
  })
  it('ToolUse carries tool_use_id and leaves output out while running', () => {
    expect(keys(toolUseProps(call))).toEqual(['input', 'isErrored', 'isInterrupted', 'isRunning', 'output', 'tool', 'tool_use_id'])
    expect('output' in toolUseProps({ ...call, output: undefined, isRunning: true })).toBe(false)
  })
  it('ToolResult', () => {
    expect(toolResultProps(call)).toEqual({ tool_use_id: 'toolu_1', tool: 'Bash', output: 'a\nb', isErrored: false })
  })
  it('ToolGroup calls are ToolGroupCall rows', () => {
    const props = toolGroupProps([call], true, false)
    expect(keys(props)).toEqual(['calls', 'isActive', 'isExpanded'])
    expect(keys(props.calls[0])).toEqual(['input', 'isErrored', 'isInterrupted', 'isRunning', 'tool', 'tool_use_id'])
  })
  it('CommandOutput names the command without its slash', () => {
    expect(commandOutputProps('/probe-cmd', '', 'out', false)).toEqual({ command: 'probe-cmd', args: '', text: 'out', isErrored: false })
  })
  it('AskUserQuestion', () => {
    expect(askUserQuestionProps([{ question: 'q' }])).toEqual({ tool: 'AskUserQuestion', questions: [{ question: 'q' }] })
  })
  it('Spinner, SessionMode, PromptHint', () => {
    expect(spinnerProps('Working', null, 'thinking')).toEqual({ word: 'Working', message: null, suffix: '…', mode: 'thinking' })
    expect(sessionModeProps([])).toEqual({ modes: [] })
    expect(promptHintProps(true, false, '')).toEqual({ isDraft: true, isWorking: false, hint: '' })
  })
})

describe('promptHintText', () => {
  const request = promptHintProps(false, false, 'Ask Claude anything')
  it('reads a replaced hint from the mod’s tree', () => {
    const tree = { type: 'Box', props: { flexDirection: 'column' }, children: [{ type: 'Text', props: { dimColor: true }, children: ['probe', ' hint'] }] } satisfies ModElement
    expect(promptHintText({ tree, props: {}, hooked: true }, request)).toBe('probe hint')
  })
  it('reads a rewritten hint through the engine node, and the request’s for later refs', () => {
    const tree = { type: 'Box', props: {}, children: [{ type: 'engine', ref: 1 }, ' · ', { type: 'engine', ref: 2 }] } satisfies ModElement
    expect(promptHintText({ tree, props: { hint: 'Ctrl+R replays' }, hooked: true }, request)).toBe('Ctrl+R replays · Ask Claude anything')
  })
})
