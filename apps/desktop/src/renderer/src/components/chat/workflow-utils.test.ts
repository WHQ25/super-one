import { describe, it, expect } from 'vitest'
import {
  parseWorkflowScript,
  parseWorkflowInput,
  parseWorkflowLaunch,
  isWorkflowSmokeCheck,
  workflowToolTargetLabel,
  extractWorkflowScriptPath,
  resolveGrokWorkflowDir,
  workflowArtifactPath,
  stripWorkflowNamePrefix,
} from './workflow-utils'

const REAL_SCRIPT = `export const meta = {
  name: 'ui-test-minimal',
  description: '极简演示 workflow，用于产生 workflow UI 展示数据',
  phases: [
    { title: 'Greet', detail: '单个 agent 返回一句问候' },
    { title: 'Fan-out', detail: '三个并行 agent 各报一个数字' },
  ],
}

const COLOR_SCHEMA = { type: 'object', properties: { color: { title: 'ignored' } } }

phase('Greet')
const greeting = await agent('用一句中文友好地打个招呼', { label: 'greet' })
`

const REAL_LAUNCH = `Workflow launched in background. Task ID: wyk4kb95q
Summary: 极简演示 workflow，用于产生 workflow UI 展示数据
Transcript dir: /Users/x/.claude/projects/p/e6c5301b/subagents/workflows/wf_2f7264c8-4e0
Script file: /Users/x/.claude/projects/p/workflows/scripts/ui-test-minimal-wf_2f7264c8-4e0.js`

describe('parseWorkflowScript', () => {
  it('extracts name, description and phase titles from the meta literal', () => {
    const meta = parseWorkflowScript(REAL_SCRIPT)
    expect(meta.name).toBe('ui-test-minimal')
    expect(meta.description).toBe('极简演示 workflow，用于产生 workflow UI 展示数据')
    expect(meta.phases.map((p) => p.title)).toEqual(['Greet', 'Fan-out'])
    expect(meta.phases[0].detail).toBe('单个 agent 返回一句问候')
  })

  it('does not pull title values from objects outside the phases array', () => {
    const meta = parseWorkflowScript(REAL_SCRIPT)
    expect(meta.phases).toHaveLength(2)
  })
})

describe('parseWorkflowInput', () => {
  it('parses the script out of the tool_use input JSON', () => {
    const meta = parseWorkflowInput(JSON.stringify({ script: REAL_SCRIPT }))
    expect(meta.name).toBe('ui-test-minimal')
    expect(meta.phases).toHaveLength(2)
  })
})

describe('isWorkflowSmokeCheck', () => {
  it('detects validate_only on parsed object and JSON string', () => {
    expect(isWorkflowSmokeCheck({ validate_only: true, script: 'x' })).toBe(true)
    expect(isWorkflowSmokeCheck({ validateOnly: true })).toBe(true)
    expect(isWorkflowSmokeCheck(JSON.stringify({ script: 'x', validate_only: true }))).toBe(true)
  })

  it('is false for live runs and empty input', () => {
    expect(isWorkflowSmokeCheck({ name: 'review-changes' })).toBe(false)
    expect(isWorkflowSmokeCheck({ validate_only: false })).toBe(false)
    expect(isWorkflowSmokeCheck(JSON.stringify({ name: 'review-changes' }))).toBe(false)
    expect(isWorkflowSmokeCheck(undefined)).toBe(false)
    expect(isWorkflowSmokeCheck('')).toBe(false)
  })

  it('detects validate_only in partial streaming JSON', () => {
    expect(isWorkflowSmokeCheck('{"script":"let meta","validate_only":true')).toBe(true)
    expect(isWorkflowSmokeCheck('{"script":"let meta"')).toBe(false)
  })
})

describe('workflowToolTargetLabel', () => {
  it('prefers name, then script path basename, then meta.name from script', () => {
    expect(workflowToolTargetLabel({ name: 'review-changes' })).toBe('review-changes')
    expect(workflowToolTargetLabel({ script_path: '/home/x/.grok/workflows/mobile-adapt.rhai' })).toBe('mobile-adapt')
    expect(workflowToolTargetLabel(JSON.stringify({ script: REAL_SCRIPT }))).toBe('ui-test-minimal')
  })
})

describe('parseWorkflowLaunch', () => {
  it('extracts transcriptDir, taskId and runId from the launch text', () => {
    const info = parseWorkflowLaunch(REAL_LAUNCH)
    expect(info.taskId).toBe('wyk4kb95q')
    expect(info.transcriptDir).toBe('/Users/x/.claude/projects/p/e6c5301b/subagents/workflows/wf_2f7264c8-4e0')
    expect(info.runId).toBe('wf_2f7264c8-4e0')
  })

  it('reads structured WorkflowOutput JSON when present', () => {
    const info = parseWorkflowLaunch(JSON.stringify({
      status: 'async_launched', taskId: 't1', runId: 'wf_x', transcriptDir: '/d',
    }))
    expect(info.taskId).toBe('t1')
    expect(info.transcriptDir).toBe('/d')
    expect(info.runId).toBe('wf_x')
  })

  it('reads Grok WorkflowToolOutput snake_case without transcriptDir', () => {
    const info = parseWorkflowLaunch(JSON.stringify({
      run_id: 'wf_live',
      task_id: 'wf_live',
      name: 'review-changes',
      script_path: '/tmp/wf.rhai',
      message: 'Workflow review-changes started.',
    }))
    expect(info.runId).toBe('wf_live')
    expect(info.taskId).toBe('wf_live')
    expect(info.scriptPath).toBe('/tmp/wf.rhai')
    expect(info.transcriptDir).toBeUndefined()
  })

  it('returns empty for undefined', () => {
    expect(parseWorkflowLaunch(undefined)).toEqual({})
  })
})

describe('extractWorkflowScriptPath', () => {
  it('reads script_path / scriptPath from JSON and partial JSON', () => {
    expect(extractWorkflowScriptPath(JSON.stringify({ script_path: '/a/b.rhai' }))).toBe('/a/b.rhai')
    expect(extractWorkflowScriptPath(JSON.stringify({ scriptPath: '/c/d.rhai' }))).toBe('/c/d.rhai')
    expect(extractWorkflowScriptPath('{"name":"x","script_path":"/p/w.rhai"')).toBe('/p/w.rhai')
  })
})

describe('resolveGrokWorkflowDir', () => {
  it('builds ~/.grok/sessions/<encodeURIComponent(cwd)>/<session>/workflows/<run_id>', () => {
    expect(resolveGrokWorkflowDir({
      runId: 'wf_abc',
      cwd: '/Users/me/proj',
      providerSessionId: '019f-sess',
      homedir: '/Users/me',
    })).toBe('/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproj/019f-sess/workflows/wf_abc')
  })

  it('rejects missing pieces and path traversal', () => {
    expect(resolveGrokWorkflowDir({ runId: 'wf_x', cwd: '/p', providerSessionId: 's', homedir: null })).toBeUndefined()
    expect(resolveGrokWorkflowDir({
      runId: '../evil',
      cwd: '/p',
      providerSessionId: 's',
      homedir: '/h',
    })).toBeUndefined()
  })
})

describe('workflowArtifactPath', () => {
  it('joins without double slashes', () => {
    expect(workflowArtifactPath('/tmp/workflows/wf_1/', 'script.rhai')).toBe('/tmp/workflows/wf_1/script.rhai')
    expect(workflowArtifactPath(undefined, 'script.rhai')).toBeUndefined()
  })
})

describe('stripWorkflowNamePrefix', () => {
  it('drops name: prefix and exact name', () => {
    expect(stripWorkflowNamePrefix('review-changes: do the thing', 'review-changes')).toBe('do the thing')
    expect(stripWorkflowNamePrefix('review-changes', 'review-changes')).toBeUndefined()
    expect(stripWorkflowNamePrefix('phase: Execute', 'review-changes')).toBe('phase: Execute')
  })
})
