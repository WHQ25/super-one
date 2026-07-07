import { describe, expect, it } from 'vitest'
import { parseTranscriptPath, slimSubagentMessages } from './subagent-transcript'

describe('parseTranscriptPath', () => {
  it('extracts sessionId and agentId from a standard subagent path', () => {
    const p = '/Users/x/.claude/projects/-Users-x-repo/7eab5843-edab-4b76-9e31-e99a1e608ef9/subagents/agent-a534845ecc0d3bb61.jsonl'
    expect(parseTranscriptPath(p)).toEqual({
      sessionId: '7eab5843-edab-4b76-9e31-e99a1e608ef9',
      agentId: 'a534845ecc0d3bb61',
    })
  })

  it('extracts ids from a workflow-nested agent path', () => {
    const p = '/Users/x/.claude/projects/-Users-x-repo/368512aa-e654-4521-8fe5-74d96d6d0557/subagents/workflows/wf_8e89a41f-23b/agent-a9252ce0a317adcc8.jsonl'
    expect(parseTranscriptPath(p)).toEqual({
      sessionId: '368512aa-e654-4521-8fe5-74d96d6d0557',
      agentId: 'a9252ce0a317adcc8',
    })
  })

  it('returns null for a non-agent path', () => {
    expect(parseTranscriptPath('/Users/x/.claude/projects/-Users-x-repo/sess/foo.jsonl')).toBeNull()
    expect(parseTranscriptPath('/tmp/agent-abc.jsonl')).toBeNull()
  })
})

describe('slimSubagentMessages', () => {
  it('keeps only assistant records and slims content blocks', () => {
    const messages = [
      { type: 'user', message: { content: [{ type: 'tool_result', text: 'x' }] } },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'hi', signature: 'drop-me' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' }, id: 'drop-me' },
      ] } },
    ]
    expect(slimSubagentMessages(messages)).toEqual([
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'hi' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } },
      ] } },
    ])
  })

  it('skips assistant records whose message content is not an array', () => {
    const messages = [
      { type: 'assistant', message: { content: 'string-content' } },
      { type: 'assistant', message: undefined },
    ]
    expect(slimSubagentMessages(messages)).toEqual([])
  })
})
