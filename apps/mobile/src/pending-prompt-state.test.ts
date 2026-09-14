import { describe, expect, it } from 'vitest'
import type { AskUserQuestionRequest, PermissionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import { collapsePrompt, collapsedPendingPrompts, expandPrompt, pendingPromptHeader, permissionPromptTitle } from './pending-prompt-state'

const bash: PermissionRequest = { requestId: 'perm-1', toolName: 'Bash', input: { command: 'bun run test', description: 'Run the suite' }, allowAlwaysAllow: true }
const edit: PermissionRequest = { requestId: 'perm-2', toolName: 'Edit', input: { file_path: '/repo/src/app.tsx', old_string: 'a', new_string: 'b' }, allowAlwaysAllow: false }
const question: AskUserQuestionRequest = { requestId: 'q-1', questions: [{ header: 'Library', question: 'Which library?\nPick one.', options: [{ label: 'A', description: '' }], multiSelect: false }] }
const plan: PlanApprovalRequest = { requestId: 'plan-1', planContent: '# Plan', planFilePath: '/repo/.claude/plans/refactor.md', allowedPrompts: [] }
const none = new Set<string>()

describe('collapsed prompt set', () => {
  it('adds and removes by request id without mutating the previous set', () => {
    const one = collapsePrompt(none, 'perm-1')
    expect([...one]).toEqual(['perm-1'])
    expect(none.size).toBe(0)
    expect(collapsePrompt(one, 'perm-1')).toBe(one)
    expect(expandPrompt(one, 'missing')).toBe(one)
    expect(expandPrompt(one, 'perm-1').size).toBe(0)
  })
})

describe('collapsedPendingPrompts', () => {
  it('lists only the put-away prompts that are still pending', () => {
    const collapsed = new Set(['perm-1', 'plan-1', 'stale'])
    const prompts = collapsedPendingPrompts({ permission: bash, question, plan }, collapsed)
    expect(prompts.map((prompt) => prompt.request.requestId)).toEqual(['perm-1', 'plan-1'])
  })

  it('is empty when nothing is collapsed, even with prompts pending', () => {
    expect(collapsedPendingPrompts({ permission: bash, question, plan }, none)).toEqual([])
  })
})

describe('pendingPromptHeader', () => {
  it('names the tool and shows the command for a plain Bash permission', () => {
    expect(pendingPromptHeader({ kind: 'permission', request: bash })).toEqual({ title: 'Bash', detail: 'bun run test' })
  })

  it('prefers the file name for edits', () => {
    expect(pendingPromptHeader({ kind: 'permission', request: edit }).detail).toBe('app.tsx')
  })

  it('uses the kind presentation for structured requests', () => {
    const request: PermissionRequest = { ...bash, requestKind: 'computer_use_grant', computerUseGrant: { app: 'Finder', bundleId: 'com.apple.finder', toolName: 'computer_use' } }
    const header = pendingPromptHeader({ kind: 'permission', request })
    expect(header.title).toBe(permissionPromptTitle(request))
    expect(header.title).toBe('Allow app control?')
    expect(header.detail).toMatch(/Computer Use/)
  })

  it('takes the first line of the first question', () => {
    expect(pendingPromptHeader({ kind: 'question', request: question })).toEqual({ title: 'Question', detail: 'Which library?' })
  })

  it('shows the plan file name', () => {
    expect(pendingPromptHeader({ kind: 'plan', request: plan })).toEqual({ title: 'Plan review', detail: 'refactor.md' })
  })
})
