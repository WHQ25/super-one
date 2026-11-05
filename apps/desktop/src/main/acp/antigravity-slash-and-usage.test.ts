import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { AgentEvent } from '@superone/shared/agent-types'
import { mapSessionUpdate } from './acp-event-map'
import { createXaiCorrelationState } from './acp-xai-session-notify'
import { ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE } from './antigravity-auto-bootstrap'
import {
  extractAllAntigravityUsageRecords,
  extractAntigravityTurnUsageAndThinking,
} from './antigravity-db-usage'
import {
  advanceAntigravityThinkingStepAfterTools,
  closeAntigravityThinkingStep,
  extractAntigravityPromptResponseUsage,
  extractAntigravityWireTurnUsage,
  finalizeAntigravityTurnThinking,
  openAntigravityThinkingStep,
  stampAntigravityThoughtDeltas,
  syncAntigravityTurnFromDb,
  type AntigravityTurnThinkingScope,
} from './antigravity-runtime-bridge'
import {
  discoverAntigravitySlashCommands,
  parseSkillFrontmatter,
} from './antigravity-slash-commands'

describe('antigravity slash commands and skills', () => {
  it('compiles ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE without Python syntax/name errors and executes _patched_send_usage_update', () => {
    const pyCheck = `
import asyncio, builtins, json, symtable, sys, types

src = sys.stdin.read()
compile(src, "sitecustomize.py", "exec")

top = symtable.symtable(src, "sitecustomize.py", "exec")
top_defs = {s.get_name() for s in top.get_symbols() if s.is_assigned() or s.is_imported()} | set(dir(builtins))

def walk_tables(tbl):
    for sym in tbl.get_symbols():
        if sym.is_global() and not sym.is_assigned() and not sym.is_imported():
            name = sym.get_name()
            if name not in top_defs:
                raise NameError(f"Unbound global symbol {name!r} in {tbl.get_name()}")
    for child in tbl.get_children():
        walk_tables(child)

walk_tables(top)

ns = {}
exec(src, ns)

class DummyAdapter:
    def __init__(self): pass
    def on_connect(self, conn): pass
    async def new_session(self, **kw): pass
    async def _restore_session(self, **kw): pass
    async def _create_agent_config(self, **kw): pass
    def _build_literal_model_target(self, m, e): pass
    async def _maybe_apply_model_switch(self, s): pass
    async def _permission_handler(self, s, tc): pass
    async def _stream_live_step(self, s, step, o, h=None): pass
    async def prompt(self, p, s, message_id=None, **kw): pass
    async def _maybe_send_usage_update(self, s): pass
    async def _send_available_commands_update(self, s): pass
    async def cleanup(self, s=None): pass
    def _extract_turn_usage(self, s, start):
        return types.SimpleNamespace(input_tokens=20000, output_tokens=150, thought_tokens=50, cached_read_tokens=18000)

updates = []
class DummyClient:
    async def request_permission(self, *a, **kw): pass
    async def session_update(self, session_id, update):
        updates.append((session_id, update))

server_mod = types.SimpleNamespace(
    config_options=types.SimpleNamespace(AVAILABLE_SESSION_MODES=()),
    schema=types.SimpleNamespace(
        SessionMode=lambda **kw: types.SimpleNamespace(**kw),
        UsageUpdate=lambda **kw: kw,
    ),
    resolve_skills_paths=lambda cwd=None, additional_directories=None: [],
    AgyAdapter=DummyAdapter,
    asyncio=asyncio,
    model_selection=types.SimpleNamespace(get_context_window_size=lambda m: 1048576),
    logging=types.SimpleNamespace(exception=lambda *a: (_ for _ in ()).throw(RuntimeError("unexpected logging.exception"))),
)

ns["_patch_server_module"](server_mod)
adapter = DummyAdapter()
adapter._client = DummyClient()
adapter.on_connect(None)
sent_events = []
class DummyConn:
    is_idle = False
    async def _send_input_event(self, ev):
        sent_events.append(ev)
dummy_conn = DummyConn()
sys.modules[DummyConn.__module__] = types.SimpleNamespace(
    localharness_pb2=types.SimpleNamespace(
        UserInput=lambda parts: {"parts": parts},
        InputEvent=lambda user_input: {"user_input": user_input},
    ),
    to_proto_input_content=lambda x: f"proto:{x}",
)
server_mod.sdk_types_module = types.SimpleNamespace(Image=lambda data, mime_type: f"img:{mime_type}:{len(data)}")
adapter._sessions = {
    "s1": types.SimpleNamespace(
        last_reported_used=20200,
        agent_model_id="gemini-3.1-pro-high",
        agent=types.SimpleNamespace(
            is_started=True,
            conversation=types.SimpleNamespace(_connection=dummy_conn),
        ),
    )
}
asyncio.run(adapter._send_usage_update("s1"))
assert len(updates) == 1
asyncio.run(
    adapter._client.session_update(
        session_id="s1",
        update=types.SimpleNamespace(
            session_update="agent_message_chunk",
            content=types.SimpleNamespace(text="Trajectory was cancelled."),
        ),
    )
)
assert len(updates) == 1
interject_res = asyncio.run(
    adapter.ext_method(
        "_x.ai/interject",
        {"sessionId": "s1", "content": [{"type": "text", "text": "steer soon msg"}]},
    )
)
assert interject_res == {"accepted": True}
assert sent_events == [{"user_input": {"parts": ["proto:steer soon msg"]}}]
print(json.dumps(updates[0][1]))
`
    const out = execFileSync('python3', ['-c', pyCheck], {
      input: ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE,
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out.trim())
    expect(parsed.field_meta.antigravityTurnUsage).toEqual({
      contextTokens: 20200,
      contextWindow: 1048576,
      model: 'gemini-3.1-pro-high',
      inputTokens: 2000,
      outputTokens: 200,
      cacheReadTokens: 18000,
      thoughtsTokens: 50,
    })
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('getattr(sdk_types, "GeminiModelOptions", None)')
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('getattr(terminal_sandbox_mod, "os_sandbox_supported", None)')
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('server_mod.acp_paths.gemini_home()')
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('_extract_tool_display_title')
    expect(ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE).toContain('_handle_antigravity_interject')
  })

  it('reconciles write_to_file permission frames with code_action (replace_file_content) execution steps without leaving Write stuck or opening a second Edit card', () => {
    const pyCheck = `
import asyncio, json, sys, time, types, uuid

src = sys.stdin.read()
ns = {}
exec(src, ns)

class FakeModel:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)
    def model_copy(self, update=None):
        d = dict(self.__dict__)
        if update:
            d.update(update)
        return FakeModel(**d)

streamed_steps = []

class DummyAdapter:
    def __init__(self): pass
    def on_connect(self, conn): pass
    async def new_session(self, **kw): pass
    async def _restore_session(self, **kw): pass
    async def _create_agent_config(self, **kw): pass
    def _build_literal_model_target(self, m, e): pass
    async def _maybe_apply_model_switch(self, s): pass
    async def _permission_handler(self, s, tc): return True
    def _resolve_permission_frame(self, session_info, call):
        if call.id in session_info.reconciled_frame_by_exec:
            return session_info.reconciled_frame_by_exec[call.id], False
        q = session_info.pending_permission_frames.get(str(call.name))
        if q:
            fid = q.pop(0)
            session_info.reconciled_frame_by_exec[call.id] = fid
            return fid, True
        return call.id, False
    async def _stream_live_step(self, session_id, step, open_tool_calls, hidden_tool_calls=None):
        session_info = self._sessions[session_id]
        for call in step.tool_calls:
            fid, reconciles = self._resolve_permission_frame(session_info, call)
            if step.status == "ACTIVE":
                open_tool_calls[fid] = str(call.name)
            elif step.status == "DONE":
                open_tool_calls.pop(fid, None)
            streamed_steps.append({
                "status": step.status,
                "frame_id": fid,
                "reconciles": reconciles,
                "call_name": call.name,
                "call_args": call.args,
            })
    async def prompt(self, p, s, message_id=None, **kw): pass
    async def _maybe_send_usage_update(self, s): pass
    async def _send_available_commands_update(self, s): pass
    async def cleanup(self, s=None): pass
    def _session_workspace_roots(self, s): return ["/workspace"]
    def _admin_file_access_always_ask(self): return False
    def _admin_terminal_requires_review(self): return False

updates = []
class DummyClient:
    async def request_permission(self, *a, **kw): pass
    async def session_update(self, session_id, update):
        updates.append(update)

server_mod = types.SimpleNamespace(
    config_options=types.SimpleNamespace(AVAILABLE_SESSION_MODES=()),
    schema=types.SimpleNamespace(
        SessionMode=lambda **kw: types.SimpleNamespace(**kw),
        ToolCallStart=lambda **kw: kw,
        ToolCallProgress=lambda **kw: kw,
    ),
    resolve_skills_paths=lambda cwd=None, additional_directories=None: [],
    AgyAdapter=DummyAdapter,
    asyncio=asyncio,
    time=time,
    uuid=uuid,
    _EXEC_TOOLS=set(),
    _AUTO_EDIT_TOOLS={"write_to_file", "replace_file_content", "multi_replace_file_content"},
    _TERMINAL_STEP_STATUSES={"DONE", "ERROR", "CANCELLED"},
    _tool_call_name=lambda tc: getattr(tc, "name", ""),
    _tool_call_target_paths=lambda tc: [tc.args["TargetFile"]] if "TargetFile" in getattr(tc, "args", {}) else ([tc.args["file_path"]] if "file_path" in getattr(tc, "args", {}) else []),
    _is_internal_mcp_schema_read=lambda *a: False,
    _call_accesses_outside_workspace=lambda *a: False,
    _unwrap_mcp_tool_call=lambda name, args, server_name=None: (None, dict(args), None),
    _extract_tool_display_title=lambda name, args, server_name=None: "Write" if name == "write_to_file" else "Edit",
    _infer_tool_kind=lambda name, args, server_name=None: "edit",
    _extract_tool_locations=lambda name, args, server_name=None: [],
    _extract_tool_content=lambda name, args, server_name=None: [],
    sdk_types_module=types.SimpleNamespace(
        StepSource=types.SimpleNamespace(MODEL="MODEL", TOOL="TOOL"),
        StepStatus=types.SimpleNamespace(ACTIVE="ACTIVE", DONE="DONE", ERROR="ERROR"),
        StepType=types.SimpleNamespace(TOOL_CALL="TOOL_CALL"),
    ),
)

ns["_patch_server_module"](server_mod)
adapter = DummyAdapter()
adapter._client = DummyClient()
adapter.on_connect(None)
session_info = types.SimpleNamespace(
    mode_id="auto_edit",
    pending_permission_frames={},
    reconciled_frame_by_exec={},
    mcp_frames={},
)
adapter._sessions = {"s1": session_info}

# 1. Permission hook receives write_to_file with full CodeContent and TargetFile
perm_call = FakeModel(
    id="",
    name="write_to_file",
    args={
        "TargetFile": "/workspace/scratch/run-ci-checks.sh",
        "CodeContent": "#!/usr/bin/env bash\\necho ok\\n",
        "Overwrite": True,
        "toolSummary": "Write scratch/run-ci-checks.sh",
    },
)
allowed = asyncio.run(adapter._permission_handler("s1", perm_call))
assert allowed is True
perm_frame_id = perm_call.id
assert perm_frame_id
assert session_info.pending_permission_frames == {"write_to_file": [perm_frame_id]}

# 2. Execution step arrives as code_action -> mapped by SDK to replace_file_content with only file_path
exec_call = FakeModel(
    id="40aa7b63-52ec-4d2e-8cb9-14fb0c13716e:33",
    name="replace_file_content",
    args={"file_path": "/workspace/scratch/run-ci-checks.sh"},
    canonical_path="/workspace/scratch/run-ci-checks.sh",
)
exec_step = FakeModel(
    id="40aa7b63-52ec-4d2e-8cb9-14fb0c13716e:33",
    step_index=33,
    source="TOOL",
    type="TOOL_CALL",
    status="DONE",
    content="Write scratch/run-ci-checks.sh",
    tool_calls=[exec_call],
    parent_trajectory_id=None,
)
open_tool_calls = {}
asyncio.run(adapter._stream_live_step("s1", exec_step, open_tool_calls))

assert session_info.pending_permission_frames == {}
assert open_tool_calls == {}
assert len(streamed_steps) == 2
assert streamed_steps[0]["frame_id"] == perm_frame_id
assert streamed_steps[0]["reconciles"] is True
assert streamed_steps[0]["call_name"] == "write_to_file"
assert streamed_steps[0]["call_args"]["CodeContent"] == "#!/usr/bin/env bash\\necho ok\\n"
assert streamed_steps[1]["frame_id"] == perm_frame_id
assert streamed_steps[1]["reconciles"] is False
assert streamed_steps[1]["call_name"] == "write_to_file"
print(json.dumps({"perm_frame_id": perm_frame_id, "streamed": streamed_steps}))
`
    const out = execFileSync('python3', ['-c', pyCheck], {
      input: ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE,
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out.trim())
    expect(parsed.streamed).toHaveLength(2)
    expect(parsed.streamed[0].frame_id).toBe(parsed.perm_frame_id)
    expect(parsed.streamed[0].call_name).toBe('write_to_file')
    expect(parsed.streamed[0].call_args.CodeContent).toBe('#!/usr/bin/env bash\necho ok\n')
    expect(parsed.streamed[1].frame_id).toBe(parsed.perm_frame_id)
  })

  it('parses single-line and multiline YAML skill frontmatter and respects disable-slash-command', () => {
    const multiline = `---
name: agy-customizations
description: >-
  Comprehensive guide and reference for the Antigravity Customization System.
  Use to explain how customizations work.
argument-hint: "[topic]"
---
# AGY Customizations
`
    expect(parseSkillFrontmatter(multiline)).toEqual({
      name: 'agy-customizations',
      description:
        'Comprehensive guide and reference for the Antigravity Customization System. Use to explain how customizations work.',
      'argument-hint': '[topic]',
    })

    const disabled = `---
name: hidden-skill
description: Hidden skill
disable-slash-command: true
---
`
    expect(parseSkillFrontmatter(disabled)['disable-slash-command']).toBe('true')
  })

  it('discovers built-in slash commands plus workspace, user, plugin, and CLI builtin skills', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-skills-test-'))
    try {
      const workspaceDir = join(root, 'workspace')
      const homeDir = join(root, 'home')
      mkdirSync(join(workspaceDir, '.git'), { recursive: true })
      mkdirSync(join(workspaceDir, '.agents', 'skills', 'superone-tool'), { recursive: true })
      writeFileSync(
        join(workspaceDir, '.agents', 'skills', 'superone-tool', 'SKILL.md'),
        '---\nname: superone-tool\ndescription: Design or change SuperOne agent tools.\n---\n',
      )
      mkdirSync(join(homeDir, '.gemini', 'config', 'plugins', 'chrome-devtools-plugin', 'skills', 'chrome-devtools'), {
        recursive: true,
      })
      writeFileSync(
        join(
          homeDir,
          '.gemini',
          'config',
          'plugins',
          'chrome-devtools-plugin',
          'skills',
          'chrome-devtools',
          'SKILL.md',
        ),
        '---\nname: chrome-devtools\ndescription: Uses Chrome DevTools via MCP.\n---\n',
      )
      mkdirSync(join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills', 'antigravity_guide'), {
        recursive: true,
      })
      writeFileSync(
        join(homeDir, '.gemini', 'antigravity-cli', 'builtin', 'skills', 'antigravity_guide', 'SKILL.md'),
        '---\nname: antigravity-guide\ndescription: Guide for Google Antigravity.\n---\n',
      )

      const commands = discoverAntigravitySlashCommands({ cwd: workspaceDir, homeDir })
      const names = commands.map((c) => c.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'plan',
          'compact',
          'goal',
          'schedule',
          'browser',
          'grill-me',
          'teamwork',
          'learn',
          'boost',
          'usage',
          'logout',
          'superone-tool',
          'chrome-devtools',
          'antigravity-guide',
        ]),
      )

      const skillEntry = commands.find((c) => c.name === 'superone-tool')
      expect(skillEntry?.isSkill).toBe(true)
      const builtinEntry = commands.find((c) => c.name === 'plan')
      expect(builtinEntry?.isSkill).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('maps available_commands_update with _meta.isSkill and usage_update with _meta.antigravityTurnUsage', () => {
    const cmdEvents = mapSessionUpdate(
      {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'plan', description: 'Plan mode' },
          {
            name: 'superone-harness',
            description: 'Harness skill',
            _meta: { path: '/repo/.agents/skills/superone-harness/SKILL.md', isSkill: true },
          },
        ],
      } as unknown as SessionUpdate,
      { messageId: 'm1' },
    )
    expect(cmdEvents).toEqual([
      {
        type: 'acp_commands',
        commands: [
          { name: 'plan', description: 'Plan mode', argumentHint: '', isSkill: false },
          { name: 'superone-harness', description: 'Harness skill', argumentHint: '', isSkill: true },
        ],
      },
    ])

    const usageEvents = mapSessionUpdate(
      {
        sessionUpdate: 'usage_update',
        used: 24500,
        size: 1000000,
        _meta: {
          antigravityTurnUsage: {
            inputTokens: 18000,
            outputTokens: 650,
            cacheReadTokens: 5850,
            thoughtsTokens: 200,
            contextTokens: 24500,
            contextWindow: 1000000,
            model: 'gemini-3.1-pro-high',
          },
        },
      } as unknown as SessionUpdate,
      { messageId: 'm1' },
    )
    expect(usageEvents).toEqual([
      {
        type: 'message_usage',
        messageId: 'm1',
        inputTokens: 18000,
        outputTokens: 650,
        cacheReadTokens: 5850,
        contextTokens: 24500,
        contextWindow: 1000000,
        model: 'gemini-3.1-pro-high',
      },
    ])
  })
})

describe('antigravity per-turn real-time and 1.4.5 SQLite token usage', () => {
  it('extracts turn usage from 1.4.5 (idx, step_payload) SQLite schema and merges wire + PromptResponse usage', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-db-145-'))
    try {
      const sessionId = 'sess_145'
      const convDir = join(root, 'antigravity', 'profile', 'antigravity-acp', 'conversations')
      mkdirSync(convDir, { recursive: true })
      const dbPath = join(convDir, `${sessionId}.db`)
      const db = new Database(dbPath)
      db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_payload BLOB NOT NULL)')

      const encodeLen = (field: number, bytes: Uint8Array): Buffer => {
        const tag = (field << 3) | 2
        const lenBytes: number[] = []
        let v = bytes.length
        while (v >= 0x80) {
          lenBytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        lenBytes.push(v)
        return Buffer.concat([Buffer.from([tag, ...lenBytes]), Buffer.from(bytes)])
      }

      const userStepPayload = encodeLen(14, Buffer.from([0x0a, 0x05, ...Buffer.from('hello')]))
      const metadataHex =
        '0a0b088be9d7ce0610c8de9725320b088de9d7ce0610f89eb24b420b088de9d7ce061088ac884d4a2b0a154d4f44454c5f504c414345484f4c4445525f4d333710918401181f22083a060801109184014847501fc2011d084720c0843d2a00421367656d696e692d332e312d70726f2d68696768'
      const innerPlanner = Buffer.concat([
        encodeLen(1, Buffer.from('Done')),
        encodeLen(3, Buffer.from('\n\nThinking deeply\n\n\nSecond paragraph\n\n\n')),
        encodeLen(11, Buffer.from([0x08, 0x02])),
      ])
      const plannerStepPayload = Buffer.concat([
        encodeLen(1, Buffer.from(metadataHex, 'hex')),
        Buffer.from([0xa2, 0x01, innerPlanner.length]),
        innerPlanner,
      ])

      const insert = db.prepare('INSERT INTO steps (idx, step_payload) VALUES (?, ?)')
      insert.run(0, userStepPayload)
      insert.run(1, plannerStepPayload)
      db.close()

      const summary = extractAntigravityTurnUsageAndThinking(sessionId, root)
      expect(summary).not.toBeNull()
      expect(summary?.inputTokens).toBe(16913)
      expect(summary?.outputTokens).toBe(102)
      expect(summary?.contextWindow).toBe(1000000)
      expect(summary?.model).toBe('gemini-3.1-pro-high')
      expect(summary?.thinkingSteps).toHaveLength(1)
      expect(summary?.thinkingSteps[0]?.thinkingText).toBe('Thinking deeply\n\nSecond paragraph')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }

    const wireUsage = extractAntigravityWireTurnUsage({
      sessionUpdate: 'usage_update',
      used: 22000,
      size: 1048576,
      _meta: {
        antigravityTurnUsage: {
          inputTokens: 15000,
          outputTokens: 420,
          cacheReadTokens: 6580,
          thoughtsTokens: 120,
          contextTokens: 22000,
          contextWindow: 1048576,
          model: 'gemini-3.1-pro-high',
        },
      },
    })
    expect(wireUsage).toEqual({
      inputTokens: 15000,
      outputTokens: 420,
      cacheReadTokens: 6580,
      thoughtsTokens: 120,
      contextTokens: 22000,
      contextWindow: 1048576,
      model: 'gemini-3.1-pro-high',
    })

    const promptUsage = extractAntigravityPromptResponseUsage({
      stopReason: 'end_turn',
      usage: {
        inputTokens: 31000,
        outputTokens: 500,
        thoughtTokens: 300,
        cachedReadTokens: 12000,
        totalTokens: 31800,
      },
    })
    expect(promptUsage).toEqual({
      inputTokens: 19000,
      outputTokens: 800,
      cacheReadTokens: 12000,
      thoughtsTokens: 300,
      contextTokens: 0,
      contextWindow: 0,
      model: '',
    })

    const events: AgentEvent[] = []
    const scope: AntigravityTurnThinkingScope = {
      sawAgentThoughtChunk: true,
      stepIndex: 0,
      stepStartedAt: 1000,
      currentStepHasThinking: false,
      currentStepThinkingClosed: false,
      currentStepHasThoughtText: false,
      emittedStepThinkingIds: [],
    }
    const corr = createXaiCorrelationState()
    const synced = syncAntigravityTurnFromDb(
      'nonexistent-session',
      'msg_live',
      scope,
      corr,
      (ev) => events.push(ev),
      false,
      wireUsage,
    )
    expect(synced).toBe(true)
    expect(events.at(-1)).toEqual({
      type: 'message_usage',
      messageId: 'msg_live',
      inputTokens: 15000,
      outputTokens: 420,
      cacheReadTokens: 6580,
      contextTokens: 22000,
      contextWindow: 1048576,
      model: 'gemini-3.1-pro-high',
    })

    finalizeAntigravityTurnThinking(
      'nonexistent-session',
      'msg_live',
      scope,
      corr,
      (ev) => events.push(ev),
      promptUsage,
    )
    expect(events.at(-1)).toEqual({
      type: 'message_usage',
      messageId: 'msg_live',
      inputTokens: 19000,
      outputTokens: 800,
      cacheReadTokens: 12000,
      contextTokens: 22000,
      contextWindow: 1048576,
      model: 'gemini-3.1-pro-high',
    })

    const thoughtScope: AntigravityTurnThinkingScope = {
      sawAgentThoughtChunk: false,
      stepIndex: 0,
      stepStartedAt: 1000,
      currentStepHasThinking: false,
      currentStepThinkingClosed: false,
      currentStepHasThoughtText: false,
      emittedStepThinkingIds: [],
    }
    const streamedEvents: AgentEvent[] = []
    openAntigravityThinkingStep(thoughtScope, 'msg_live', (ev) => streamedEvents.push(ev))
    const c1 = mapSessionUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '\n\nFirst paragraph.\n\n\n' } } as SessionUpdate,
      { messageId: 'msg_live' },
    )
    stampAntigravityThoughtDeltas(thoughtScope, c1)
    const c2 = mapSessionUpdate(
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Second paragraph.\n\n\n' } } as SessionUpdate,
      { messageId: 'msg_live' },
    )
    stampAntigravityThoughtDeltas(thoughtScope, c2)
    closeAntigravityThinkingStep(thoughtScope, 'msg_live', (ev) => streamedEvents.push(ev))
    const combinedThinking = [...c1, ...c2]
      .filter((ev): ev is Extract<AgentEvent, { type: 'content_delta' }> => ev.type === 'content_delta')
      .map((ev) => (ev.delta.type === 'thinking' ? ev.delta.thinking : ''))
      .join('')
    expect(combinedThinking).toBe('First paragraph.\n\nSecond paragraph.')
  })

  it('computes uncached input tokens across multi-step turn in SQLite without duplicating cache reads', () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-multistep-'))
    try {
      const sessionId = 'sess_multi'
      const convDir = join(root, 'antigravity', 'profile', 'antigravity-acp', 'conversations')
      mkdirSync(convDir, { recursive: true })
      const dbPath = join(convDir, `${sessionId}.db`)
      const db = new Database(dbPath)
      db.exec('CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB, step_payload BLOB)')

      const encodeLen = (field: number, bytes: Uint8Array): Buffer => {
        const tag = (field << 3) | 2
        const lenBytes: number[] = []
        let v = bytes.length
        while (v >= 0x80) {
          lenBytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        lenBytes.push(v)
        return Buffer.concat([Buffer.from([tag, ...lenBytes]), Buffer.from(bytes)])
      }

      const encodeVarint = (field: number, val: number): Buffer => {
        const tag = (field << 3) | 0
        const bytes = [tag]
        let v = val
        while (v >= 0x80) {
          bytes.push((v & 0x7f) | 0x80)
          v >>>= 7
        }
        bytes.push(v)
        return Buffer.from(bytes)
      }

      const userStepPayload = encodeLen(14, Buffer.from([0x0a, 0x05, ...Buffer.from('hello')]))

      const buildMeta = (
        inputTokens: number,
        outputTokens: number,
        cacheReadTokens: number,
        thoughtsTokens: number,
        candidatesTokens: number,
      ): Buffer => {
        const ts = encodeVarint(1, 1730764800)
        const stats = Buffer.concat([
          encodeLen(1, Buffer.from('gemini-3.1-pro-high')),
          encodeVarint(2, inputTokens),
          encodeVarint(3, outputTokens),
          encodeVarint(5, cacheReadTokens),
          encodeVarint(9, thoughtsTokens),
          encodeVarint(10, candidatesTokens),
        ])
        return Buffer.concat([encodeLen(1, ts), encodeLen(9, stats)])
      }

      const meta1 = buildMeta(1000, 70, 19000, 20, 50)
      const planner1 = Buffer.concat([
        encodeLen(1, Buffer.from('Calling tool')),
        encodeLen(3, Buffer.from('thinking step 1')),
      ])
      const step1Payload = Buffer.concat([
        Buffer.from([0xa2, 0x01, planner1.length]),
        planner1,
      ])

      const meta2 = buildMeta(200, 80, 20050, 0, 80)
      const planner2 = Buffer.concat([
        encodeLen(1, Buffer.from('Final answer')),
      ])
      const step2Payload = Buffer.concat([
        Buffer.from([0xa2, 0x01, planner2.length]),
        planner2,
      ])

      const insert = db.prepare('INSERT INTO steps (idx, step_type, metadata, step_payload) VALUES (?, ?, ?, ?)')
      insert.run(0, 14, null, userStepPayload)
      insert.run(1, 15, meta1, step1Payload)
      insert.run(2, 15, meta2, step2Payload)
      db.close()

      const summary = extractAntigravityTurnUsageAndThinking(sessionId, root)
      expect(summary).not.toBeNull()
      expect(summary?.inputTokens).toBe(1200)
      expect(summary?.outputTokens).toBe(150)
      expect(summary?.cacheReadTokens).toBe(39050)
      expect(summary?.contextTokens).toBe(20330)
      expect(summary?.thinkingSteps).toHaveLength(1)
      expect(summary?.thinkingSteps[0]?.thinkingText).toBe('thinking step 1')

      const records = extractAllAntigravityUsageRecords(root)
      expect(records).toEqual([
        {
          providerSessionId: sessionId,
          createdAt: 1730764800000,
          model: 'gemini-3.1-pro-high',
          inputTokens: 1000,
          outputTokens: 70,
          cacheReadTokens: 19000,
        },
        {
          providerSessionId: sessionId,
          createdAt: 1730764800000,
          model: 'gemini-3.1-pro-high',
          inputTokens: 200,
          outputTokens: 80,
          cacheReadTokens: 20050,
        },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not eagerly open thinking on advanceAntigravityThinkingStepAfterTools and retracts empty thinking', () => {
    const scope: AntigravityTurnThinkingScope = {
      sawAgentThoughtChunk: false,
      stepIndex: 0,
      stepStartedAt: 1000,
      currentStepHasThinking: false,
      currentStepThinkingClosed: false,
      currentStepHasThoughtText: false,
      emittedStepThinkingIds: [],
    }
    const events: AgentEvent[] = []
    const emit = (ev: AgentEvent) => events.push(ev)
    const corr = createXaiCorrelationState()

    // 1. Advance after tool: does NOT emit thinking content_delta
    advanceAntigravityThinkingStepAfterTools('nonexistent', 'm1', scope, corr, emit)
    expect(scope.stepIndex).toBe(1)
    expect(scope.currentStepHasThinking).toBe(false)
    expect(events.filter((e) => e.type === 'content_delta')).toHaveLength(0)

    // 2. Open thinking step but no thought chunks arrive
    openAntigravityThinkingStep(scope, 'm1', emit)
    expect(scope.currentStepHasThinking).toBe(true)
    expect(events.some((e) => e.type === 'content_delta' && e.delta.type === 'thinking')).toBe(true)

    // 3. closeAntigravityThinkingStep without thought text retracts the block
    closeAntigravityThinkingStep(scope, 'm1', emit)
    expect(events.some((e) => e.type === 'content_retracted')).toBe(true)
    expect(scope.currentStepHasThinking).toBe(false)

    // 4. finalizeAntigravityTurnThinking on open step without thought text retracts
    scope.stepIndex = 0
    scope.currentStepThinkingClosed = false
    scope.currentStepHasThoughtText = false
    openAntigravityThinkingStep(scope, 'm1', emit)
    finalizeAntigravityTurnThinking('nonexistent', 'm1', scope, corr, emit)
    const retractions = events.filter((e) => e.type === 'content_retracted')
    expect(retractions.length).toBeGreaterThanOrEqual(2)
    expect(scope.currentStepHasThinking).toBe(false)
  })

  it('does not prematurely close open MCP tool calls on call_mcp_tool dispatch and forwards MCP metadata on completion', () => {
    const pyCheck = `
import asyncio, json, sys, time, types, uuid

src = sys.stdin.read()
ns = {}
exec(src, ns)

class FakeModel:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)
    def model_copy(self, update=None):
        d = dict(self.__dict__)
        if update:
            d.update(update)
        return FakeModel(**d)

emitted_updates = []
class DummyClient:
    async def request_permission(self, *a, **kw): pass
    async def session_update(self, session_id, update):
        emitted_updates.append((session_id, update))

class DummyAdapter:
    def __init__(self): pass
    def on_connect(self, conn): pass
    async def new_session(self, **kw): pass
    async def _restore_session(self, **kw): pass
    async def _create_agent_config(self, **kw): pass
    def _build_literal_model_target(self, m, e): pass
    async def _permission_handler(self, s, tc): return True
    def _resolve_permission_frame(self, session_info, call):
        if call.id in session_info.reconciled_frame_by_exec:
            return session_info.reconciled_frame_by_exec[call.id], False
        queue = session_info.pending_permission_frames.get(str(call.name))
        if not queue:
            queue = session_info.pending_permission_frames.get("session_read")
        if queue:
            fid = queue.pop(0)
            session_info.reconciled_frame_by_exec[call.id] = fid
            return fid, True
        return call.id, False
    async def _stream_live_step(self, session_id, step, open_tool_calls, hidden_tool_calls=None):
        session_info = self._sessions[session_id]
        if step.status != "ERROR":
            for call in step.tool_calls:
                fid, reconciles = self._resolve_permission_frame(session_info, call)
                open_tool_calls[fid] = str(call.name)
        if step.type == "TOOL_CALL" and step.status == "DONE":
            for call in step.tool_calls:
                fid = session_info.reconciled_frame_by_exec.get(call.id, call.id)
                if fid in open_tool_calls:
                    open_tool_calls.pop(fid, None)
                    session_info.mcp_frames.pop(fid, None)
                    await self._client.session_update(
                        session_id=session_id,
                        update=FakeModel(
                            session_update="tool_call_update",
                            tool_call_id=fid,
                            raw_output=step.content,
                            status="completed",
                        ),
                    )
    async def prompt(self, p, s, message_id=None, **kw): pass
    async def _maybe_send_usage_update(self, s): pass
    async def _send_available_commands_update(self, s): pass
    async def cleanup(self, s=None): pass

server_mod = types.SimpleNamespace(
    config_options=types.SimpleNamespace(AVAILABLE_SESSION_MODES=()),
    schema=types.SimpleNamespace(
        SessionMode=lambda **kw: types.SimpleNamespace(**kw),
        ToolCallProgress=lambda **kw: FakeModel(**kw),
    ),
    resolve_skills_paths=lambda cwd=None, additional_directories=None: [],
    AgyAdapter=DummyAdapter,
    asyncio=asyncio,
    time=time,
    uuid=uuid,
    _TERMINAL_STEP_STATUSES={"DONE", "ERROR", "CANCELLED"},
    _tool_call_name=lambda tc: getattr(tc, "name", ""),
    _tool_call_target_paths=lambda tc: [],
    _is_internal_mcp_schema_read=lambda *a: False,
    _call_accesses_outside_workspace=lambda *a: False,
    _unwrap_mcp_tool_call=lambda name, args, server_name=None: (None, dict(args), None),
    sdk_types_module=types.SimpleNamespace(
        StepSource=types.SimpleNamespace(MODEL="MODEL", TOOL="TOOL"),
        StepStatus=types.SimpleNamespace(ACTIVE="ACTIVE", DONE="DONE", ERROR="ERROR"),
        StepType=types.SimpleNamespace(TOOL_CALL="TOOL_CALL"),
    ),
    acp_paths=types.SimpleNamespace(gemini_home=lambda: tmp_home),
    json=json,
)

import os, tempfile
tmp_home = tempfile.mkdtemp()
logs_dir = os.path.join(tmp_home, "antigravity-acp", "brain", "s1", ".system_generated", "logs")
os.makedirs(logs_dir, exist_ok=True)
with open(os.path.join(logs_dir, "transcript.jsonl"), "w", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "step_index": 13,
        "type": "MCP_TOOL",
        "status": "DONE",
        "content": "Created At: 2026-11-05T18:52:56+08:00\\nCompleted At: 2026-11-05T18:52:56+08:00\\n# Session s-1\\nFull markdown session body",
    }) + "\\n")

ns["_patch_server_module"](server_mod)
adapter = DummyAdapter()
adapter._client = DummyClient()
adapter.on_connect(None)

session_info = types.SimpleNamespace(
    pending_permission_frames={"session_read": ["frame_123"]},
    mcp_frames={"frame_123": ("superone_session_read", {"sessionId": "s-1"}, {"mcp": {"server": "superone", "tool": "session_read"}})},
    reconciled_frame_by_exec={},
)
adapter._sessions = {"s1": session_info}
adapter._permission_call_by_frame_id["frame_123"] = (
    "call_mcp_tool",
    {"ServerName": "superone", "ToolName": "session_read", "Arguments": {"sessionId": "s-1"}, "toolSummary": "Read user queries from session"},
    set(),
)
open_tool_calls = {"frame_123": "session_read"}

# 1. Step A: model emits call_mcp_tool with preview summary as step.content
step_a = FakeModel(
    id="s1_12",
    step_index=12,
    type="TOOL_CALL",
    status="DONE",
    source="MODEL",
    parent_trajectory_id=None,
    tool_calls=[FakeModel(id="call_dispatch_1", name="call_mcp_tool", args={"ServerName": "superone", "ToolName": "session_read", "Arguments": {"sessionId": "s-1"}})],
    content="Read session s-1",
)
asyncio.run(adapter._stream_live_step("s1", step_a, open_tool_calls))

# Assert: Step A did NOT close frame_123
assert "frame_123" in open_tool_calls, "frame_123 should still be open after dispatch"
assert "frame_123" in session_info.pending_permission_frames["session_read"], "pending frame should not be consumed by dispatch"
assert len(emitted_updates) == 0, "no completion update should be emitted on dispatch step"

# 2. Step B: live LocalConnectionStep has step.content = tool_summary ("Read user queries from session"), while real output is in transcript.jsonl/SQLite
step_b = FakeModel(
    id="s1_13",
    step_index=13,
    type="TOOL_CALL",
    status="DONE",
    source="MODEL",
    parent_trajectory_id=None,
    tool_calls=[FakeModel(id="s1_13", name="session_read", args={"sessionId": "s-1"}, server_name="superone")],
    content="Read user queries from session",
)
asyncio.run(adapter._stream_live_step("s1", step_b, open_tool_calls))

# Assert: Step B closed frame_123 with enriched MCP metadata and real output resolved from persisted step
assert "frame_123" not in open_tool_calls, "frame_123 should be closed after execution"
assert len(emitted_updates) == 1, "exactly one completion update expected"
sess_id, done_up = emitted_updates[0]
assert done_up.tool_call_id == "frame_123"
assert done_up.raw_output == "# Session s-1\\nFull markdown session body"
assert done_up.title == "superone_session_read"
assert done_up.kind == "execute"
assert done_up.field_meta == {"mcp": {"server": "superone", "tool": "session_read"}}
assert done_up.raw_input == {"sessionId": "s-1"}
print(json.dumps({"ok": True, "raw_output": done_up.raw_output, "title": done_up.title}))
`
    const out = execFileSync('python3', ['-c', pyCheck], {
      input: ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE,
      encoding: 'utf8',
    })
    const parsed = JSON.parse(out.trim())
    expect(parsed.ok).toBe(true)
    expect(parsed.raw_output).toContain('# Session s-1')
    expect(parsed.title).toBe('superone_session_read')
  })

  it('resolves SQLite mcp_tool output accurately when omitted planner_response steps shift StepUpdate.step_index behind steps.idx', () => {
    const pyCheck = `
import asyncio, json, os, sqlite3, sys, tempfile, time, types, uuid

src = sys.stdin.read()
ns = {}
exec(src, ns)

class FakeModel:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)
    def model_copy(self, update=None):
        d = dict(self.__dict__)
        if update:
            d.update(update)
        return FakeModel(**d)

class FakeToolCallProto:
    def __init__(self, name="", arguments_json=""):
        self.name = name
        self.arguments_json = arguments_json

class FakeMcpToolProto:
    def __init__(self, name="", arguments_json="", result_string=""):
        self.tool_call = FakeToolCallProto(name, arguments_json)
        self.result_string = result_string
        self.result_uri = ""
    def WhichOneof(self, oneof_name):
        return "result_string" if self.result_string else None

class FakeStepProto:
    def __init__(self):
        self._kind = None
        self.mcp_tool = FakeMcpToolProto()
    def ParseFromString(self, payload):
        obj = json.loads(payload.decode("utf-8"))
        self._kind = obj.get("kind")
        if self._kind == "mcp_tool":
            self.mcp_tool = FakeMcpToolProto(
                obj.get("name", ""),
                json.dumps(obj.get("args", {})),
                obj.get("result_string", ""),
            )
    def WhichOneof(self, oneof_name):
        return self._kind

tmp_dir = tempfile.mkdtemp()
db_path = os.path.join(tmp_dir, "s_offset.db")
conn = sqlite3.connect(db_path)
conn.execute("CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB, step_payload BLOB)")
rows = [
    (8, {"kind": "mcp_tool", "name": "session_rename", "args": {"title": "Test"}, "result_string": '{"ok":true}'}),
    (9, {"kind": "planner_response"}),
    (10, {"kind": "mcp_tool", "name": "session_list", "args": {"limit": 3}, "result_string": '[{"sessionId":"s-1","title":"One"}]'}),
    (11, {"kind": "mcp_tool", "name": "session_read", "args": {"sessionId": "s-1", "view": "meta"}, "result_string": '{"sessionId":"s-1","messageCount":10}'}),
    (12, {"kind": "planner_response"}),
    (13, {"kind": "mcp_tool", "name": "session_read", "args": {"sessionId": "s-1", "view": "user"}, "result_string": "# User View\\n### [u0] (10:00)\\nHello"}),
    (14, {"kind": "planner_response"}),
    (15, {"kind": "mcp_tool", "name": "session_read", "args": {"sessionId": "s-1", "view": "assistant"}, "result_string": "# Assistant View\\n### [a1] (10:01)\\nWorld"}),
]
for r_idx, r_obj in rows:
    conn.execute("INSERT INTO steps (idx, step_type, metadata, step_payload) VALUES (?, 30, NULL, ?)", (r_idx, json.dumps(r_obj).encode("utf-8")))
conn.commit()
conn.close()

server_mod = types.SimpleNamespace(
    asyncio=asyncio,
    json=json,
    session_store=types.SimpleNamespace(trajectory_path=lambda sid: db_path),
    trajectory_pb2=types.SimpleNamespace(Step=FakeStepProto),
    _tool_call_name=lambda tc: getattr(tc, "name", ""),
)

adapter = types.SimpleNamespace(
    _used_mcp_db_idxs_by_session={},
    _matched_mcp_db_idx_by_step={},
    _turn_min_mcp_db_idx_by_session={"s_offset": 0},
)

live_steps = [
    FakeModel(id="s_offset:8", step_index=8, tool_calls=[FakeModel(name="session_rename", args={"title": "Test"}, server_name="superone")]),
    FakeModel(id="s_offset:9", step_index=9, tool_calls=[FakeModel(name="session_list", args={"limit": 3}, server_name="superone")]),
    FakeModel(id="s_offset:10", step_index=10, tool_calls=[FakeModel(name="session_read", args={"sessionId": "s-1", "view": "meta"}, server_name="superone")]),
    FakeModel(id="s_offset:11", step_index=11, tool_calls=[FakeModel(name="session_read", args={"sessionId": "s-1", "view": "user"}, server_name="superone")]),
    FakeModel(id="s_offset:13", step_index=13, tool_calls=[FakeModel(name="session_read", args={"sessionId": "s-1", "view": "assistant"}, server_name="superone")]),
]

outputs = [
    asyncio.run(ns["_resolve_live_mcp_step_output"](adapter, server_mod, "s_offset", st))
    for st in live_steps
]
print(json.dumps(outputs))
`
    const out = execFileSync('python3', ['-c', pyCheck], {
      input: ANTIGRAVITY_SITE_CUSTOMIZE_SOURCE,
      encoding: 'utf8',
    })
    const outputs = JSON.parse(out.trim())
    expect(outputs).toEqual([
      '{"ok":true}',
      '[{"sessionId":"s-1","title":"One"}]',
      '{"sessionId":"s-1","messageCount":10}',
      '# User View\n### [u0] (10:00)\nHello',
      '# Assistant View\n### [a1] (10:01)\nWorld',
    ])
  })
})

