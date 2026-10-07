import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'
import { withSubagentResumeSignal } from './subagent-resume-signal'

const started: AgentEvent = { type: 'task_started', taskId: 'task-1', toolUseId: 'agent', description: 'Review', taskType: 'local_agent' }
const notified: AgentEvent = { type: 'task_notification', taskId: 'task-1', toolUseId: 'agent', taskStatus: 'completed', outputFile: '' }
const wake: AgentEvent = { type: 'content_delta', messageId: 'm2', delta: { type: 'tool_use', toolName: 'SendMessage', toolUseId: 'send', input: '{}' } }
const child: AgentEvent = { type: 'content_delta', messageId: 'm2', delta: { type: 'text', text: 'more', parentToolUseId: 'agent' } }

function run(events: AgentEvent[]): AgentEvent[] {
  const out: AgentEvent[] = []
  const emit = withSubagentResumeSignal(event => out.push(event))
  for (const event of events) emit(event)
  return out
}

const resumeFrames = (events: AgentEvent[]) => events.filter(event => event.type === 'task_started' && event.isBackgrounded)

describe('withSubagentResumeSignal', () => {
  it('registers a woken agent again once, before its first resumed frame', () => {
    const out = run([started, notified, wake, child, child])
    expect(resumeFrames(out)).toEqual([{ type: 'task_started', taskId: 'task-1', toolUseId: 'agent', description: 'Review', isBackgrounded: true }])
    expect(out.indexOf(resumeFrames(out)[0]!)).toBe(out.indexOf(child) - 1)
  })

  it('ignores a straggling child frame that no SendMessage preceded', () => {
    expect(resumeFrames(run([started, notified, child]))).toEqual([])
  })

  it('re-keys the run the SDK registers for a resume to the Agent block', () => {
    // Claude Code 2.1.292: the resumed run's task events name the SendMessage call.
    const sdkResume: AgentEvent = { type: 'task_started', taskId: 'task-1', toolUseId: 'send', description: 'Review', taskType: 'local_agent', isBackgrounded: true }
    const resumeProgress: AgentEvent = { type: 'task_progress', taskId: 'task-1', toolUseId: 'send', description: 'Reading', usage: { totalTokens: 1, toolUses: 1, durationMs: 1 } }
    const resumeNotified: AgentEvent = { ...notified, toolUseId: 'send' } as AgentEvent
    const out = run([started, notified, wake, sdkResume, child, resumeProgress, resumeNotified])
    expect(resumeFrames(out)).toEqual([{ ...sdkResume, toolUseId: 'agent' }])
    expect(out.filter(event => event.type.startsWith('task_')).map(event => 'toolUseId' in event && event.toolUseId)).toEqual(['agent', 'agent', 'agent', 'agent', 'agent'])
  })

  it('leaves task events of other tasks alone', () => {
    const shell: AgentEvent = { type: 'task_started', taskId: 'shell-1', toolUseId: 'bash', description: 'sleep', taskType: 'local_bash' }
    expect(run([started, shell])).toEqual([started, shell])
  })

  it('announces each resume after the run finishes again', () => {
    const resumeNotified: AgentEvent = { ...notified, toolUseId: 'send' } as AgentEvent
    expect(resumeFrames(run([started, notified, wake, child, resumeNotified, wake, child]))).toHaveLength(2)
  })
})
