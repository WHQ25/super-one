import { OPERATION_SCOPES } from '@superone/shared/environment'
import { asRecord, mapThrown, requireScopes, type RpcHandlerTable } from './rpc-helpers'
import type { RpcContext as HostRpcContext, RpcResult } from './rpc-context'

type RpcContext = HostRpcContext & Required<Pick<HostRpcContext, 'terminals'>>

export const TERMINAL_HANDLERS: RpcHandlerTable<RpcContext> = {
  'terminal.list': (payload, ctx) => handleTerminalList(payload, ctx),
  'terminal.create': (payload, ctx) => handleTerminalCreate(payload, ctx),
  'terminal.attach': (payload, ctx) => handleTerminalAttach(payload, ctx),
  'terminal.read': (payload, ctx) => handleTerminalRead(payload, ctx),
  'terminal.write': (payload, ctx) => handleTerminalWrite(payload, ctx),
  'terminal.resize': (payload, ctx) => handleTerminalResize(payload, ctx),
  'terminal.kill': (payload, ctx) => handleTerminalKill(payload, ctx),
  'terminal.acquireControl': (payload, ctx) => handleTerminalAcquireControl(payload, ctx),
  'terminal.renewControl': (payload, ctx) => handleTerminalRenewControl(payload, ctx),
  'terminal.releaseControl': (payload, ctx) => handleTerminalReleaseControl(payload, ctx),
}

function handleTerminalCreate(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    const target = terminalWorkspace(p, ctx)
    const cwd = target?.cwd ?? (typeof p.cwd === 'string' ? p.cwd : process.cwd())
    const info = ctx.terminals.create({
      cwd,
      ...(target ? { projectPath: target.projectPath } : {}),
      title: typeof p.title === 'string' ? p.title : undefined,
      cols: typeof p.cols === 'number' ? p.cols : undefined,
      rows: typeof p.rows === 'number' ? p.rows : undefined,
    })
    return {
      result: {
        terminalId: info.terminalId,
        cwd: info.cwd,
        title: info.title,
        cols: info.cols,
        rows: info.rows,
      },
    }
  } catch (err) {
    return mapThrown(err)
  }
}

/** The host resolves a session's checkout; callers never substitute a display project key for its cwd. */
function terminalWorkspace(payload: Record<string, unknown>, ctx: RpcContext): { projectPath: string; cwd: string } | null {
  if (payload.projectId === undefined && payload.sessionId === undefined) return null
  if (typeof payload.projectId !== 'string' || !payload.projectId) throw Object.assign(new Error('projectId required'), { code: 'invalid_argument' })
  const project = ctx.projects?.get(payload.projectId)
  if (!project) throw Object.assign(new Error('project not found'), { code: 'not_found' })
  if (payload.sessionId === undefined) return { projectPath: project.path, cwd: project.path }
  if (typeof payload.sessionId !== 'string' || !payload.sessionId) throw Object.assign(new Error('sessionId must be a nonempty string'), { code: 'invalid_argument' })
  const session = ctx.sessions?.get(payload.sessionId)
  if (!session || session.projectId !== project.projectId) throw Object.assign(new Error('session not found in project'), { code: 'not_found' })
  return { projectPath: project.path, cwd: session.cwd ?? project.path }
}

function handleTerminalList(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  try {
    const target = terminalWorkspace(asRecord(payload), ctx)
    const terminals = ctx.terminals.list().filter(item => !target
      || item.cwd === target.cwd || item.cwd === target.projectPath
      || item.cwd.startsWith(target.projectPath.endsWith('/') ? target.projectPath : `${target.projectPath}/`))
    return { result: { terminals } }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleTerminalAttach(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  try {
    return { result: await ctx.terminals.attach(terminalId, ctx.client.clientSessionId) }
  } catch (err) {
    return mapThrown(err)
  }
}

async function handleTerminalRead(payload: unknown, ctx: RpcContext): Promise<RpcResult> {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: await ctx.terminals.readAfter(
        String(p.terminalId ?? ''),
        typeof p.afterSequence === 'string' ? p.afterSequence : '0',
      ),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function requireTerminalLease(payload: Record<string, unknown>, ctx: RpcContext, terminalId: string): RpcResult | null {
  try {
    ctx.leases.assertValid({
      resource: { environmentId: ctx.identity.environmentId, terminalId },
      leaseId: String(payload.leaseId ?? ''),
      generation: String(payload.generation ?? ''),
      holderClientId: ctx.client.clientSessionId,
    })
    return null
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalWrite(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  const leaseErr = requireTerminalLease(p, ctx, terminalId)
  if (leaseErr) return leaseErr
  const data = String(p.data ?? '')
  if (data.length > 64 * 1024) {
    return { error: { code: 'invalid_argument', message: 'terminal write payload too large' } }
  }
  try {
    ctx.terminals.write(terminalId, data)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalResize(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  const leaseErr = requireTerminalLease(p, ctx, terminalId)
  if (leaseErr) return leaseErr
  const cols = Number(p.cols ?? 80)
  const rows = Number(p.rows ?? 24)
  try {
    ctx.terminals.resize(terminalId, cols, rows)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalKill(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  const leaseErr = requireTerminalLease(p, ctx, terminalId)
  if (leaseErr) return leaseErr
  try {
    ctx.terminals.kill(terminalId)
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalAcquireControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  const terminalId = String(p.terminalId ?? '')
  try {
    return {
      result: ctx.leases.acquire({
        resource: { environmentId: ctx.identity.environmentId, terminalId },
        holderClientId: ctx.client.clientSessionId,
        ...(typeof p.delegate === 'string' && p.delegate ? { delegate: p.delegate } : {}),
        ...(p.yields === true ? { yields: true } : {}),
        ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalRenewControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    return {
      result: ctx.leases.renew({
        leaseId: String(p.leaseId ?? ''),
        generation: String(p.generation ?? ''),
        holderClientId: ctx.client.clientSessionId,
        ttlMs: typeof p.ttlMs === 'number' ? p.ttlMs : undefined,
      }),
    }
  } catch (err) {
    return mapThrown(err)
  }
}

function handleTerminalReleaseControl(payload: unknown, ctx: RpcContext): RpcResult {
  const denied = requireScopes(ctx.client, OPERATION_SCOPES.operateTerminal)
  if (denied) return denied
  const p = asRecord(payload)
  try {
    ctx.leases.release(
      String(p.leaseId ?? ''),
      String(p.generation ?? ''),
      ctx.client.clientSessionId,
    )
    return { result: { ok: true } }
  } catch (err) {
    return mapThrown(err)
  }
}
