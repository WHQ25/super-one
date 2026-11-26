import { describe, it, expect } from 'vitest'
import {
  parseWorkflowScript,
  parseWorkflowInput,
  parseWorkflowLaunch,
  isWorkflowSmokeCheck,
  workflowToolTargetLabel,
  extractWorkflowScript,
  extractWorkflowScriptPath,
  resolveGrokWorkflowDir,
  workflowArtifactPath,
  stripWorkflowNamePrefix,
  mergeWorkflowPhaseRows,
  detectWorkflowScriptLanguage,
  looksLikePythonWorkflow,
  parseAntigravityWorkflowLog,
  resolveWorkflowAdapter,
  normalizeWorkflowRun,
  stripFileUri,
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

  it('extracts title+detail from Rhai #{ } phase maps', () => {
    const meta = parseWorkflowScript(`let meta = #{
    name: "grok-build-parity",
    description: "Clone/update grok-build source",
    phases: [
        #{ title: "Source", detail: "ensure local grok-build checkout" },
        #{ title: "Catalog", detail: "enumerate Grok Build capabilities from source + docs" },
    ],
};`)
    expect(meta.name).toBe('grok-build-parity')
    expect(meta.phases).toEqual([
      { title: 'Source', detail: 'ensure local grok-build checkout' },
      { title: 'Catalog', detail: 'enumerate Grok Build capabilities from source + docs' },
    ])
  })
})

describe('mergeWorkflowPhaseRows', () => {
  it('overlays meta details onto live Grok title+state rows', () => {
    expect(mergeWorkflowPhaseRows(
      [
        { title: 'Source', state: 'done' },
        { title: 'Catalog', state: 'active' },
        { title: 'Inventory', state: 'pending' },
      ],
      [
        { title: 'Source', detail: 'ensure local grok-build checkout' },
        { title: 'Catalog', detail: 'enumerate capabilities' },
        { title: 'Inventory', detail: 'map SuperOne coverage' },
        { title: 'Gap', detail: 'write the plan' },
      ],
    )).toEqual([
      { title: 'Source', state: 'done', detail: 'ensure local grok-build checkout' },
      { title: 'Catalog', state: 'active', detail: 'enumerate capabilities' },
      { title: 'Inventory', state: 'pending', detail: 'map SuperOne coverage' },
    ])
  })

  it('keeps live detail and falls back to declared phases when Grok has not sent rows yet', () => {
    expect(mergeWorkflowPhaseRows(
      [{ title: 'Source', state: 'active', detail: 'live override' }],
      [{ title: 'Source', detail: 'from script' }],
    )).toEqual([{ title: 'Source', state: 'active', detail: 'live override' }])
    expect(mergeWorkflowPhaseRows(
      undefined,
      [{ title: 'Source', detail: 'from script' }],
    )).toEqual([{ title: 'Source', detail: 'from script' }])
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

  it('reads a Grok launch target nested under source', () => {
    expect(workflowToolTargetLabel({ source: { type: 'name', name: 'grok-build-parity' } })).toBe('grok-build-parity')
    expect(workflowToolTargetLabel({ source: { type: 'script_path', script_path: '/x/.grok/workflows/parity.rhai' } })).toBe('parity')
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

describe('Antigravity run_workflow support', () => {
  it('parses PascalCase Script, ScriptPath, and Description from input', () => {
    const input = JSON.stringify({
      Description: 'Minimal run_workflow test',
      Script: 'phase("Demo")\nlog("hi")',
      ScriptPath: '/tmp/scratch/demo.py',
    })
    expect(extractWorkflowScript(input)).toBe('phase("Demo")\nlog("hi")')
    expect(extractWorkflowScriptPath(input)).toBe('/tmp/scratch/demo.py')
    expect(parseWorkflowInput(input)).toEqual({
      name: '',
      description: 'Minimal run_workflow test',
      phases: [{ title: 'Demo' }],
    })
    expect(workflowToolTargetLabel(input)).toBe('demo.py')
  })

  it('extracts Python phase() titles while skipping comments and strings even when summary is done', () => {
    const script = [
      '# phase("Commented")',
      'note = "phase(\'InsideString\')"',
      'phase("Echo")',
      'phase("Verify")',
      'phase("Echo")',
    ].join('\n')
    const normalized = normalizeWorkflowRun({
      input: JSON.stringify({
        Description: 'Minimal run_workflow example',
        Script: script,
        WaitMsBeforeAsync: 10000,
        variant: 'Workflow',
      }),
      summary: 'done',
    })
    expect(normalized.harness).toBe('antigravity')
    expect(normalized.scriptLanguage).toBe('python')
    expect(normalized.supportsStaticGraph).toBe(true)
    expect(normalized.supportsJsReplay).toBe(false)
    expect(normalized.phases).toEqual([{ title: 'Echo' }, { title: 'Verify' }])
  })

  it('extracts lowercase task id and logPath from Antigravity background task ack', () => {
    const summary = 'Tool is running as a background task with task id: 0a6e0690-bf30-4dec-ae4c-4bd5e0dd780d/task-6\nTask logs are available at: file:///tmp/task-6.log'
    expect(parseWorkflowLaunch(summary)).toEqual({
      harness: 'antigravity',
      taskId: '0a6e0690-bf30-4dec-ae4c-4bd5e0dd780d/task-6',
      logPath: '/tmp/task-6.log',
      isBackgroundLaunchAck: true,
    })
  })

  it('decodes file:// URIs with spaces when extracting logPath', () => {
    expect(stripFileUri('file:///Users/me/My%20Logs/task-2.log')).toBe('/Users/me/My Logs/task-2.log')
    const summary = 'Tool is running as a background task with task id: conv/task-2\nTask logs are available at: file:///Users/me/My%20Logs/task-2.log'
    expect(parseWorkflowLaunch(summary).logPath).toBe('/Users/me/My Logs/task-2.log')
  })
})

describe('detectWorkflowScriptLanguage', () => {
  it('detects python from .py path and Python workflow syntax', () => {
    expect(detectWorkflowScriptLanguage('x = 1', '/tmp/demo.py')).toBe('python')
    expect(detectWorkflowScriptLanguage('phase("Demo")\nlog("ok")')).toBe('python')
    expect(detectWorkflowScriptLanguage('results = await parallel(items, lambda x: agent(f"Check {x}"))')).toBe('python')
    expect(detectWorkflowScriptLanguage('def helper(x):\n    return x')).toBe('python')
    expect(detectWorkflowScriptLanguage('async def run(x):\n    return await agent(x)')).toBe('python')
    expect(looksLikePythonWorkflow('msg = f"hello {name}"')).toBe(true)
  })

  it('keeps rhai and javascript detection intact', () => {
    expect(detectWorkflowScriptLanguage('let meta = #{ name: "x" };\nphase("S");')).toBe('rhai')
    expect(detectWorkflowScriptLanguage('phase("S")', '/tmp/wf.rhai')).toBe('rhai')
    expect(detectWorkflowScriptLanguage(REAL_SCRIPT)).toBe('javascript')
    expect(detectWorkflowScriptLanguage('phase("S")\nawait agent("hi", { label: "a" })')).toBe('javascript')
    expect(detectWorkflowScriptLanguage('phase("S")', '/tmp/wf.js')).toBe('javascript')
  })
})

describe('parseAntigravityWorkflowLog', () => {
  it('parses phases, agents with colons in labels, logs, and Output section', () => {
    const raw = [
      'Logs:',
      '- [phase] Demo',
      '- apple: crisp red fruit',
      '- [agent:self] Fact: apple: done (conv-apple): "Apples are red.\\nCrisp too."',
      '- [agent:research] Fact: banana: failed (conv-banana): "Timed out"',
      '- [phase] Summary',
      '- [agent:self] Merge: running (conv-merge)',
      'Output:',
      'All done',
      'Line 2',
    ].join('\n')

    expect(parseAntigravityWorkflowLog(raw)).toEqual({
      phases: [{ title: 'Demo' }, { title: 'Summary' }],
      agents: [
        {
          agentId: 'conv-apple',
          jsonlPath: '',
          label: 'Fact: apple',
          toolCount: 0,
          phase: 'Demo',
          state: 'done',
          agentType: 'self',
          transcriptAvailable: false,
          resultText: 'Apples are red.\nCrisp too.',
          result: 'Apples are red.\nCrisp too.',
        },
        {
          agentId: 'conv-banana',
          jsonlPath: '',
          label: 'Fact: banana',
          toolCount: 0,
          phase: 'Demo',
          state: 'failed',
          agentType: 'research',
          transcriptAvailable: false,
          resultText: 'Timed out',
          result: 'Timed out',
        },
        {
          agentId: 'conv-merge',
          jsonlPath: '',
          label: 'Merge',
          toolCount: 0,
          phase: 'Summary',
          state: 'running',
          agentType: 'self',
          transcriptAvailable: false,
        },
      ],
      logs: ['apple: crisp red fruit'],
      resultText: 'All done\nLine 2',
    })
  })

  it('upserts repeated agent lines by agentId and parses structured JSON results', () => {
    const raw = [
      '- [phase] Check',
      '- [agent:self] Audit: running (a1)',
      '- [agent:self] Audit: done (a1): {"ok":true}',
    ].join('\n')
    const parsed = parseAntigravityWorkflowLog(raw)
    expect(parsed?.agents).toHaveLength(1)
    expect(parsed?.agents[0]).toMatchObject({
      agentId: 'a1',
      label: 'Audit',
      phase: 'Check',
      state: 'done',
      resultText: '{\n  "ok": true\n}',
      result: { ok: true },
    })
  })

  it('parses multi-turn agent lines with turn metadata without misclassifying them as logs', () => {
    const raw = [
      '- [phase] Phase 3: Critique',
      '- [agent:self] Brand Critic: running, turn 2 (35f91d8c-2448-4d63-b941-b874b92ee4b6)',
      '- [agent:self] Brand Critic: done, turn 4 (35f91d8c-2448-4d63-b941-b874b92ee4b6): "赛博朋克茶室"',
    ].join('\n')
    const parsed = parseAntigravityWorkflowLog(raw)
    expect(parsed?.logs).toEqual([])
    expect(parsed?.phases).toEqual([{ title: 'Phase 3: Critique' }])
    expect(parsed?.agents).toEqual([
      {
        agentId: '35f91d8c-2448-4d63-b941-b874b92ee4b6',
        jsonlPath: '',
        label: 'Brand Critic',
        toolCount: 0,
        phase: 'Phase 3: Critique',
        state: 'done',
        agentType: 'self',
        transcriptAvailable: false,
        resultText: '赛博朋克茶室',
        result: '赛博朋克茶室',
      },
    ])
  })
})

describe('workflow harness adapters & normalizeWorkflowRun', () => {
  it('resolves the matching adapter per harness without cross-leaking assumptions', () => {
    expect(resolveWorkflowAdapter(
      JSON.stringify({ Description: 'Py wf', Script: 'phase("Demo")\nlog("ok")' }),
      'Tool is running as a background task with task id: c/task-1\nTask logs are available at: file:///tmp/task-1.log',
    ).id).toBe('antigravity')

    expect(resolveWorkflowAdapter(
      JSON.stringify({ name: 'review-changes' }),
      JSON.stringify({ run_id: 'wf_1', task_id: 'wf_1', name: 'review-changes' }),
    ).id).toBe('grok')

    expect(resolveWorkflowAdapter(
      JSON.stringify({ script: REAL_SCRIPT }),
      REAL_LAUNCH,
    ).id).toBe('claude')
  })

  it('normalizes Antigravity runs with python language, logPath, and no Grok transcriptDir', () => {
    const normalized = normalizeWorkflowRun({
      input: JSON.stringify({
        Description: 'Parallel facts',
        Script: 'phase("Demo")\nres = await parallel(["apple"], lambda x: agent(f"Fact {x}"))',
      }),
      summary: 'Tool is running as a background task with task id: conv/task-6\nTask logs are available at: file:///tmp/task-6.log',
      runContext: { cwd: '/Users/me/proj', providerSessionId: 'sess-1', homedir: '/Users/me' },
      rawLogText: '- [phase] Demo\n- apple: red\n- [agent:self] Fact: apple: done (a1): "Red fruit"',
    })
    expect(normalized.harness).toBe('antigravity')
    expect(normalized.scriptLanguage).toBe('python')
    expect(normalized.transcriptDir).toBeUndefined()
    expect(normalized.logPath).toBe('/tmp/task-6.log')
    expect(normalized.supportsJsReplay).toBe(false)
    expect(normalized.supportsStaticGraph).toBe(true)
    expect(normalized.phases).toEqual([{ title: 'Demo' }])
    expect(normalized.logs).toEqual(['apple: red'])
    expect(normalized.agents).toHaveLength(1)
    expect(normalized.agents[0].resultText).toBe('Red fruit')
  })
})
