import { basename } from 'node:path'
import { encode as toonEncode } from '@toon-format/toon'
import type { AgentEvent, TerminalListItem } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { normalizeTerminalCommand, terminalCommandRuleFor } from '@superone/shared/terminal-command-rules'
import { HOST_ACTION_TERMINAL_DESCRIPTORS, TERMINAL_ACTION_INPUT_SCHEMA } from '@superone/shared/environment/host-action-terminal-descriptors'
import type { CreateTerminalOptions } from '../terminal/terminal-manager'
import type { TerminalSession } from '../terminal/terminal-session'
import { terminalKeySequence } from '../terminal/terminal-keys'
import { hasWaitCondition, waitForTerminal, type TerminalWaitConditions } from '../terminal/terminal-wait'
import { spillLargeBrowserField } from './browser-mcp-artifacts'
import { awaitTerminalCommandConfirm } from './terminal-command-confirm'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

/** What the handlers need from `TerminalManager`; kept narrow so tests pass a stub. */
export interface TerminalToolHost {
  create(opts: CreateTerminalOptions): TerminalSession
  get(terminalId: string): TerminalSession | undefined
  listForProject(projectPath: string, sessionCwd?: string): TerminalListItem[]
  kill(terminalId: string): void
}

export interface TerminalRuleStore {
  isPreapproved(projectKey: string, command: string): boolean
  add(projectKey: string, pattern: string): void
}

export interface TerminalToolDeps {
  manager: TerminalToolHost
  rules: TerminalRuleStore
}

export interface TerminalTabsArgs {
  action?: 'list' | 'run' | 'attach' | 'close'
  tab?: string | string[]
  command?: string
  cwd?: string
  title?: string
  size?: { cols: number; rows: number }
  yieldMs?: number
  description?: string
}

export interface TerminalSnapshotArgs {
  tab: string
  include?: Array<'screen' | 'scrollback' | 'cursor' | 'meta'>
  tail?: number
}

export type TerminalAction =
  | { type: 'type'; text: string; enter?: boolean }
  | { type: 'key'; key: string; repeat?: number }
  | { type: 'raw'; bytes: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'wait'; ms: number }

export interface TerminalActArgs {
  tab: string
  actions: TerminalAction[]
  expect?: TerminalWaitConditions
  timeoutMs?: number
  description?: string
}

export interface TerminalWaitForArgs extends TerminalWaitConditions {
  tab: string
  timeoutMs?: number
}

const DEFAULT_COLS = 120
const DEFAULT_ROWS = 40
const DEFAULT_RUN_YIELD_MS = 5_000
const MAX_RUN_YIELD_MS = 30_000
/** Output must be quiet this long before `run` hands the screen back. */
const RUN_SETTLE_IDLE_MS = 400
/** A fresh shell gets this long to print its first prompt before the command is typed. */
const SHELL_READY_TIMEOUT_MS = 5_000
const DEFAULT_ACT_TIMEOUT_MS = 15_000
const MAX_ACT_TIMEOUT_MS = 60_000
const DEFAULT_WAIT_TIMEOUT_MS = 15_000
const MAX_WAIT_TIMEOUT_MS = 120_000
const DEFAULT_TAIL = 200
const MAX_TAIL = 2_000
const MAX_ACTIONS = 20
const MAX_ACTION_WAIT_MS = 5_000
const MAX_KEY_REPEAT = 100

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
    ...(isError ? { isError: true as const } : {}),
  }
}

const NOT_LOCAL = '[Error] Terminal tools are not available for remote-node sessions yet.'

const TERMINAL_ARG_NAMES = new Map(
  HOST_ACTION_TERMINAL_DESCRIPTORS.map((def) => [def.name, Object.keys((def.inputSchema as { properties: object }).properties)]),
)
const TERMINAL_ACTION_ARG_NAMES = Object.keys(TERMINAL_ACTION_INPUT_SCHEMA.properties)

function closestName(name: string, accepted: readonly string[]): string | undefined {
  const needle = name.toLowerCase()
  return accepted.find((a) => a.toLowerCase().startsWith(needle) || needle.startsWith(a.toLowerCase()))
}

/**
 * Zod registration strips unknown keys, so a misspelt option (`timeout` for
 * `timeoutMs`, `action` for an act step's `type`) would silently fall back to the
 * default and the model would never learn. Name the key and the closest match.
 */
function unknownArgsError(tool: string, args: object, actions?: unknown): ReturnType<typeof toolResult> | null {
  const check = (obj: object, accepted: readonly string[], where: string) => {
    for (const key of Object.keys(obj)) {
      if (accepted.includes(key)) continue
      const suggestion = closestName(key, accepted)
      return toolResult(`[Error] Unknown parameter "${key}"${where}${suggestion ? ` — did you mean "${suggestion}"?` : ''} Accepted: ${accepted.join(', ')}.`, true)
    }
    return null
  }
  const top = check(args, TERMINAL_ARG_NAMES.get(tool) ?? [], ` for ${tool}`)
  if (top) return top
  if (Array.isArray(actions)) {
    for (const [i, action] of actions.entries()) {
      if (!action || typeof action !== 'object') continue
      const bad = check(action, TERMINAL_ACTION_ARG_NAMES, ` in actions[${i}]`)
      if (bad) return bad
    }
  }
  return null
}

interface ToolSession {
  sessionId: string
  projectPath: string
  cwd: string
  emitHostEvent: (event: AgentEvent) => void
}

function resolveContext(deps: BuiltInSuperoneToolDeps):
  | { ok: true; terminals: TerminalToolDeps; session: ToolSession }
  | { ok: false; error: ReturnType<typeof toolResult> } {
  const terminals = deps.terminals
  if (!terminals) return { ok: false, error: toolResult('[Error] Terminal tools are unavailable in this host.', true) }
  const session = deps.sessionHost?.getSession(deps.sessionId)
  if (!session?.projectPath || !session.emitHostEvent) {
    return { ok: false, error: toolResult('[Error] No project is open for this session.', true) }
  }
  if (parseRemoteProjectKey(session.projectPath)) return { ok: false, error: toolResult(NOT_LOCAL, true) }
  return {
    ok: true,
    terminals,
    session: {
      sessionId: deps.sessionId,
      projectPath: session.projectPath,
      cwd: session.cwd || session.projectPath,
      emitHostEvent: session.emitHostEvent.bind(session),
    },
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

/** A tab this session may see: the user's tabs and the ones its own agent opened. */
function visibleTo(item: Pick<TerminalListItem, 'agentSessionId'>, sessionId: string): boolean {
  return !item.agentSessionId || item.agentSessionId === sessionId
}

/**
 * Resolve a tab id the way the session sees the world: another session's
 * agent tab is reported as missing, the same as it is left out of `list`.
 */
function findTab(terminals: TerminalToolDeps, sessionId: string, id: string): TerminalSession | undefined {
  const target = terminals.manager.get(id)
  return target && visibleTo(target, sessionId) ? target : undefined
}

/** Reading is allowed on tabs this session's agent opened, or while it controls the command. */
function canRead(session: TerminalSession, sessionId: string): boolean {
  return session.agentSessionId === sessionId || session.control.heldBy(sessionId)
}

async function describeTab(session: TerminalSession, sessionId: string) {
  const control = session.agentControl
  return {
    tab: session.terminalId,
    tabStatus: session.status,
    foreground: session.foregroundProcess() || null,
    control: control ? (control.sessionId === sessionId ? 'me' : 'other-session') : 'none',
    command: control?.command ?? null,
    altScreen: session.altScreen,
    screen: await session.screenLines(),
  }
}

function rejected(reason: 'command_exited' | 'user_took_over' | 'held_by_other_session', extra: Record<string, unknown> = {}) {
  const hint = reason === 'held_by_other_session'
    ? 'Another session controls this tab. Do not retry; ask the user.'
    : reason === 'user_took_over'
      ? 'The user took over this tab. Do not retry on your own — ask before requesting it again.'
      : 'The approved command is no longer in the foreground. Start a new one with terminal_tabs action=run.'
  return toolResult({ status: 'rejected', reason, hint, ...extra })
}

function lostControlReason(session: TerminalSession): 'command_exited' | 'user_took_over' | 'held_by_other_session' {
  if (session.agentControl) return 'held_by_other_session'
  return session.control.lastReleaseReason === 'user_took_over' ? 'user_took_over' : 'command_exited'
}

async function settleAfterRun(session: TerminalSession, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    session.control.poll()
    if (!session.agentControl || session.status !== 'running') return
    if (session.control.commandRunning && Date.now() - session.lastOutputAt >= RUN_SETTLE_IDLE_MS) return
    if (Date.now() - startedAt >= timeoutMs || signal?.aborted) return
    await new Promise<void>((resolve) => setTimeout(resolve, 100))
  }
}

function tabIds(tab: TerminalTabsArgs['tab']): string[] {
  if (Array.isArray(tab)) return tab.filter((id) => typeof id === 'string' && id)
  return typeof tab === 'string' && tab ? [tab] : []
}

export async function terminalTabsHandler(args: TerminalTabsArgs, deps: BuiltInSuperoneToolDeps) {
  const ctx = resolveContext(deps)
  if (!ctx.ok) return ctx.error
  const badArg = unknownArgsError('terminal_tabs', args)
  if (badArg) return badArg
  const { terminals, session } = ctx
  const action = args.action ?? 'list'

  if (action === 'list') {
    const items = terminals.manager.listForProject(session.projectPath, session.cwd).filter((item) => visibleTo(item, session.sessionId))
    const rows = items.map((item) => {
      const live = terminals.manager.get(item.terminalId)
      return {
        tab: item.terminalId,
        title: item.title,
        cwd: item.cwd,
        status: item.status,
        foreground: live?.foregroundProcess() || '',
        control: item.agentControl ? (item.agentControl.sessionId === session.sessionId ? 'me' : 'other-session') : 'none',
        openedBy: item.agentSessionId ? 'agent' : 'user',
        altScreen: live?.altScreen ?? false,
      }
    })
    return toolResult(toonEncode({ count: rows.length, tabs: rows }))
  }

  if (action === 'run') {
    const command = normalizeTerminalCommand(String(args.command ?? ''))
    if (!command) return toolResult('[Error] command is required for action=run.', true)
    const ids = tabIds(args.tab)
    let target = ids[0] ? findTab(terminals, session.sessionId, ids[0]) : undefined
    if (ids[0] && !target) return toolResult(`[Error] Tab ${ids[0]} not found. Call terminal_tabs action=list.`, true)
    if (target) {
      if (target.status !== 'running') return toolResult(`[Error] Tab ${target.terminalId} has exited; omit tab to open a new one.`, true)
      if (target.agentControl && !target.control.heldBy(session.sessionId)) return rejected('held_by_other_session', { tab: target.terminalId })
      if (!target.isAtShell()) {
        return toolResult(`[Error] Tab ${target.terminalId} is busy running ${target.foregroundProcess()}. Wait for it, use terminal_act, or omit tab to open a new one.`, true)
      }
    }
    const cwd = typeof args.cwd === 'string' && args.cwd ? args.cwd : (target?.cwd ?? session.cwd)
    const rule = terminalCommandRuleFor(command)

    if (!terminals.rules.isPreapproved(session.projectPath, command)) {
      let decision
      try {
        decision = await awaitTerminalCommandConfirm({
          emitHostEvent: session.emitHostEvent,
          action: 'run',
          command,
          cwd,
          rule,
          tabTitle: target?.title,
          description: typeof args.description === 'string' ? args.description : undefined,
          message: `Run \`${command}\` in a terminal tab (${cwd})?`,
          allowAlwaysAllow: true,
          signal: deps.signal,
        })
      } catch (error) {
        return toolResult({ status: 'cancelled', reason: error instanceof Error ? error.message : String(error), hint: 'Do not retry on your own — wait for the user.' })
      }
      if (decision.action !== 'accept') {
        return toolResult({ status: 'rejected', reason: decision.reason ?? 'User declined', hint: 'Do not retry on your own — wait for the user.' })
      }
      if (decision.alwaysAllow) terminals.rules.add(session.projectPath, rule)
    }

    if (!target) {
      target = terminals.manager.create({
        cwd,
        projectPath: session.projectPath,
        title: typeof args.title === 'string' && args.title ? args.title : command.split(' ')[0] || basename(cwd),
        cols: clampInt(args.size?.cols, DEFAULT_COLS, 20, 400),
        rows: clampInt(args.size?.rows, DEFAULT_ROWS, 5, 200),
        agentSessionId: session.sessionId,
      })
      // Let the login shell print its prompt and go quiet before the command lands
      // in its input; typing earlier leaves the line echoed by both the tty and ZLE.
      await waitForTerminal(target, { idleMs: 700 }, { timeoutMs: SHELL_READY_TIMEOUT_MS, signal: deps.signal })
    }
    if (target.status !== 'running') return toolResult({ status: 'error', reason: 'The shell exited before the command could run.', ...(await describeTab(target, session.sessionId)) }, true)

    target.control.grant({ sessionId: session.sessionId, command, startedAt: Date.now() })
    target.input(`${command}\r`)
    await settleAfterRun(target, clampInt(args.yieldMs, DEFAULT_RUN_YIELD_MS, 250, MAX_RUN_YIELD_MS), deps.signal)
    const tab = await describeTab(target, session.sessionId)
    // A command that already returned to the prompt (crashed, port taken, one-shot
    // by mistake) leaves a tab the model tends to forget about.
    const hint = target.status === 'running' && tab.control === 'none'
      ? 'The command already exited. Read the screen, then terminal_tabs action=close this tab unless you still need it.'
      : undefined
    return toolResult({ status: 'ok', ...(hint ? { hint } : {}), ...tab })
  }

  if (action === 'attach') {
    const id = tabIds(args.tab)[0]
    if (!id) return toolResult('[Error] tab is required for action=attach.', true)
    const target = findTab(terminals, session.sessionId, id)
    if (!target) return toolResult(`[Error] Tab ${id} not found. Call terminal_tabs action=list.`, true)
    if (target.status !== 'running') return toolResult(`[Error] Tab ${id} has exited.`, true)
    if (target.control.heldBy(session.sessionId)) return toolResult({ status: 'ok', ...(await describeTab(target, session.sessionId)) })
    if (target.agentControl) return rejected('held_by_other_session', { tab: id })
    const command = target.foregroundProcess()
    if (target.isAtShell() || !command) {
      return toolResult(`[Error] Tab ${id} is at a shell prompt with nothing running; use action=run with a command instead.`, true)
    }
    if (!terminals.rules.isPreapproved(session.projectPath, command)) {
      let decision
      try {
        decision = await awaitTerminalCommandConfirm({
          emitHostEvent: session.emitHostEvent,
          action: 'attach',
          command,
          cwd: target.cwd,
          rule: terminalCommandRuleFor(command),
          tabTitle: target.title,
          description: typeof args.description === 'string' ? args.description : undefined,
          message: `Let the agent interact with \`${command}\` running in tab “${target.title}”?`,
          allowAlwaysAllow: true,
          signal: deps.signal,
        })
      } catch (error) {
        return toolResult({ status: 'cancelled', reason: error instanceof Error ? error.message : String(error), hint: 'Do not retry on your own — wait for the user.' })
      }
      if (decision.action !== 'accept') {
        return toolResult({ status: 'rejected', reason: decision.reason ?? 'User declined', hint: 'Do not retry on your own — wait for the user.' })
      }
      if (decision.alwaysAllow) terminals.rules.add(session.projectPath, terminalCommandRuleFor(command))
    }
    target.control.grant({ sessionId: session.sessionId, command, startedAt: Date.now() })
    target.control.poll()
    return toolResult({ status: 'ok', ...(await describeTab(target, session.sessionId)) })
  }

  if (action === 'close') {
    const ids = tabIds(args.tab)
    if (ids.length === 0) return toolResult('[Error] tab is required for action=close.', true)
    const closed: string[] = []
    const skipped: Array<{ tab: string; reason: string }> = []
    for (const id of ids) {
      const target = findTab(terminals, session.sessionId, id)
      if (!target) {
        skipped.push({ tab: id, reason: 'not found' })
        continue
      }
      const mine = canRead(target, session.sessionId)
      if (!mine) {
        let decision
        try {
          decision = await awaitTerminalCommandConfirm({
            emitHostEvent: session.emitHostEvent,
            action: 'close',
            command: target.foregroundProcess() || target.title,
            cwd: target.cwd,
            tabTitle: target.title,
            description: typeof args.description === 'string' ? args.description : undefined,
            message: `Close the terminal tab “${target.title}”? This kills whatever is running in it.`,
            allowAlwaysAllow: false,
            signal: deps.signal,
          })
        } catch (error) {
          return toolResult({ status: 'cancelled', reason: error instanceof Error ? error.message : String(error), closed, hint: 'Do not retry on your own — wait for the user.' })
        }
        if (decision.action !== 'accept') {
          skipped.push({ tab: id, reason: decision.reason ?? 'User declined' })
          continue
        }
      }
      terminals.manager.kill(id)
      closed.push(id)
    }
    return toolResult({ status: skipped.length && !closed.length ? 'rejected' : 'ok', closed, skipped })
  }

  return toolResult(`[Error] Unknown action ${String(action)}.`, true)
}

export async function terminalSnapshotHandler(args: TerminalSnapshotArgs, deps: BuiltInSuperoneToolDeps) {
  const ctx = resolveContext(deps)
  if (!ctx.ok) return ctx.error
  const badArg = unknownArgsError('terminal_snapshot', args)
  if (badArg) return badArg
  const target = findTab(ctx.terminals, ctx.session.sessionId, String(args.tab ?? ''))
  if (!target) return toolResult(`[Error] Tab ${String(args.tab)} not found. Call terminal_tabs action=list.`, true)
  if (!canRead(target, ctx.session.sessionId)) {
    return toolResult(`[Error] Tab ${target.terminalId} belongs to the user. Use terminal_tabs action=attach while a command is running in it.`, true)
  }
  const include = new Set(Array.isArray(args.include) && args.include.length ? args.include : ['screen'])
  const out: Record<string, unknown> = { tab: target.terminalId, status: target.status }
  if (include.has('screen')) out.screen = await target.screenLines()
  if (include.has('scrollback')) {
    const tail = clampInt(args.tail, DEFAULT_TAIL, 1, MAX_TAIL)
    const { lines, totalLines } = await target.bufferTail(tail)
    out.scrollback = lines.join('\n')
    out.scrollbackLines = lines.length
    out.totalLines = totalLines
  }
  if (include.has('cursor')) out.cursor = target.cursor()
  if (include.has('meta')) {
    const control = target.agentControl
    out.meta = {
      title: target.title,
      cwd: target.cwd,
      foreground: target.foregroundProcess() || null,
      control: control ? (control.sessionId === ctx.session.sessionId ? 'me' : 'other-session') : 'none',
      command: control?.command ?? null,
      altScreen: target.altScreen,
      cols: target.cols,
      rows: target.rows,
      openedBy: target.agentSessionId ? 'agent' : 'user',
    }
  }
  return toolResult(include.has('scrollback') ? spillLargeBrowserField(ctx.session.sessionId, out, 'scrollback', 'txt') : out)
}

function actionBytes(action: TerminalAction, session: TerminalSession): string | { error: string } {
  switch (action.type) {
    case 'type': {
      if (typeof action.text !== 'string') return { error: 'type needs text' }
      return action.enter === false ? action.text : `${action.text}\r`
    }
    case 'key': {
      const seq = terminalKeySequence(String(action.key ?? ''), { applicationCursor: session.applicationCursor })
      if (seq === null) return { error: `Unknown key "${String(action.key)}"` }
      return seq.repeat(clampInt(action.repeat, 1, 1, MAX_KEY_REPEAT))
    }
    case 'raw':
      return typeof action.bytes === 'string' ? action.bytes : { error: 'raw needs bytes' }
    default:
      return { error: `Unknown action type "${String((action as { type?: unknown }).type)}"` }
  }
}

export async function terminalActHandler(args: TerminalActArgs, deps: BuiltInSuperoneToolDeps) {
  const ctx = resolveContext(deps)
  if (!ctx.ok) return ctx.error
  const badArg = unknownArgsError('terminal_act', args, args.actions)
  if (badArg) return badArg
  const target = findTab(ctx.terminals, ctx.session.sessionId, String(args.tab ?? ''))
  if (!target) return toolResult(`[Error] Tab ${String(args.tab)} not found. Call terminal_tabs action=list.`, true)
  const actions = Array.isArray(args.actions) ? args.actions : []
  if (actions.length === 0 || actions.length > MAX_ACTIONS) return toolResult(`[Error] actions must hold 1–${MAX_ACTIONS} items.`, true)

  const sessionId = ctx.session.sessionId
  target.control.poll()
  if (!target.control.heldBy(sessionId)) {
    return rejected(lostControlReason(target), await describeTab(target, sessionId))
  }

  let executed = 0
  for (const action of actions) {
    if (action.type === 'resize') {
      target.resize(clampInt(action.cols, target.cols, 20, 400), clampInt(action.rows, target.rows, 5, 200))
      executed += 1
      continue
    }
    if (action.type === 'wait') {
      await new Promise<void>((resolve) => setTimeout(resolve, clampInt(action.ms, 0, 0, MAX_ACTION_WAIT_MS)))
      executed += 1
      continue
    }
    const bytes = actionBytes(action, target)
    if (typeof bytes !== 'string') return toolResult({ status: 'error', reason: bytes.error, stepsExecuted: executed, ...(await describeTab(target, sessionId)) }, true)
    if (!target.agentInput(sessionId, bytes)) {
      return rejected(lostControlReason(target), { stepsExecuted: executed, ...(await describeTab(target, sessionId)) })
    }
    executed += 1
  }

  let expectMet: boolean | undefined
  let conditions: Record<string, boolean | undefined> | undefined
  if (args.expect && hasWaitCondition(args.expect)) {
    const result = await waitForTerminal(target, args.expect, {
      timeoutMs: clampInt(args.timeoutMs, DEFAULT_ACT_TIMEOUT_MS, 100, MAX_ACT_TIMEOUT_MS),
      signal: deps.signal,
    })
    expectMet = result.met
    conditions = result.conditions
  } else {
    // Give the program a beat to echo/react so the returned screen reflects the input.
    await waitForTerminal(target, { idleMs: 150 }, { timeoutMs: 1_000, signal: deps.signal })
  }
  return toolResult({
    status: 'ok',
    stepsExecuted: executed,
    ...(expectMet !== undefined ? { expectMet, conditions } : {}),
    ...(await describeTab(target, sessionId)),
  })
}

export async function terminalWaitForHandler(args: TerminalWaitForArgs, deps: BuiltInSuperoneToolDeps) {
  const ctx = resolveContext(deps)
  if (!ctx.ok) return ctx.error
  const badArg = unknownArgsError('terminal_wait_for', args)
  if (badArg) return badArg
  const target = findTab(ctx.terminals, ctx.session.sessionId, String(args.tab ?? ''))
  if (!target) return toolResult(`[Error] Tab ${String(args.tab)} not found. Call terminal_tabs action=list.`, true)
  if (!canRead(target, ctx.session.sessionId)) {
    return toolResult(`[Error] Tab ${target.terminalId} belongs to the user. Use terminal_tabs action=attach while a command is running in it.`, true)
  }
  const conditions: TerminalWaitConditions = {
    ...(typeof args.text === 'string' ? { text: args.text } : {}),
    ...(typeof args.textGone === 'string' ? { textGone: args.textGone } : {}),
    ...(typeof args.idleMs === 'number' ? { idleMs: clampInt(args.idleMs, 0, 0, MAX_WAIT_TIMEOUT_MS) } : {}),
    ...(args.exited === true ? { exited: true } : {}),
  }
  if (!hasWaitCondition(conditions)) return toolResult('[Error] Provide at least one condition: text, textGone, idleMs, exited.', true)
  const result = await waitForTerminal(target, conditions, {
    timeoutMs: clampInt(args.timeoutMs, DEFAULT_WAIT_TIMEOUT_MS, 100, MAX_WAIT_TIMEOUT_MS),
    signal: deps.signal,
  })
  return toolResult({
    status: result.met ? 'ok' : 'timeout',
    met: result.met,
    conditions: result.conditions,
    elapsedMs: result.elapsedMs,
    ...(await describeTab(target, ctx.session.sessionId)),
  })
}
