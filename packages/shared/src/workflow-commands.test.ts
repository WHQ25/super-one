import { describe, expect, it } from 'vitest'
import {
  isProjectScopedWorkflowCommand,
  withoutProjectScopedWorkflows,
} from './workflow-commands'

describe('withoutProjectScopedWorkflows', () => {
  it('drops project-scoped workflow ads and keeps builtin, user, and non-workflow commands', () => {
    const commands = [
      { name: 'clear', description: 'Clear', argumentHint: '', isSkill: false },
      {
        name: 'grok-build-parity',
        description: 'Parity scan',
        argumentHint: '',
        isSkill: false,
        isWorkflow: true,
        workflowSource: 'project',
      },
      {
        name: 'deep-research',
        description: 'Research',
        argumentHint: '',
        isSkill: false,
        isWorkflow: true,
        workflowSource: 'builtin',
      },
      {
        name: 'mobile-adapt',
        description: 'Adapt',
        argumentHint: '',
        isSkill: false,
        isWorkflow: true,
        workflowSource: 'user',
      },
    ]
    expect(commands.filter(isProjectScopedWorkflowCommand).map((c) => c.name)).toEqual([
      'grok-build-parity',
    ])
    expect(withoutProjectScopedWorkflows(commands).map((c) => c.name)).toEqual([
      'clear',
      'deep-research',
      'mobile-adapt',
    ])
  })
})
