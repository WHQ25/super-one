/**
 * Remote git worktree mutations via node RPC.
 * Paths on the node are host-absolute; UI may store remote:<conn>:<hostPath>.
 */

import { closeSync, openSync, readSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type {
  WorktreeActivateRequest,
  WorktreeAssignResult,
  WorktreeHandoffResult,
  GitDirtyStatus,
  BranchImportResult,
  BranchRelation,
  BranchTip,
  CheckoutProgressPhase,
} from '@superone/shared/agent-types'
import { servesMethod, TEMP_FILE_CHUNK_BYTES } from '@superone/shared/environment'
import { parseRemoteProjectKey, remoteProjectKey } from '@superone/shared/remote-resource-key'
import { sanitizeGitRef } from '../path-security'
import type { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'
import { resolveRemoteProjectContext } from './remote-file-tree'
import { transferCancelledError } from './remote-temp-files'

function asRemoteGw(host: EnvironmentHost, environmentId: string): RemoteEnvironmentGateway | null {
  const gw = host.getGateway(environmentId)
  return gw instanceof RemoteEnvironmentGateway ? gw : null
}

function hostPathOf(folderOrRemoteKey: string): string {
  const remote = parseRemoteProjectKey(folderOrRemoteKey)
  return remote?.path ?? folderOrRemoteKey
}

export async function remoteActivateWorktree(
  host: EnvironmentHost,
  folderPath: string,
  request: WorktreeActivateRequest | null,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, error: 'environment is not connected' }

  try {
    if (request === null) {
      // Clear worktree — callers set session cwd to project root separately.
      return { ok: true, path: ctx.hostPath }
    }
    const result = (await gw.gitWorktreeActivate(ctx.projectId, {
      baseBranch: request.baseBranch,
      mode: request.mode,
      branchName: request.branchName,
      carryLocalChanges: request.carryLocalChanges,
    })) as { path: string; recordedBranch?: string | null }
    if (!result?.path) return { ok: false, error: 'worktree activate returned no path' }
    // Return remote key so UI git/status routing stays on the remote path.
    return { ok: true, path: remoteProjectKey(ctx.connectionId, result.path) }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'worktree activate failed' }
  }
}

export async function remoteCheckedOutBranches(
  host: EnvironmentHost,
  folderPath: string,
): Promise<string[] | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return []
  try {
    const result = (await gw.gitWorktreeCheckedOutBranches(ctx.projectId)) as {
      branches?: string[]
    }
    return Array.isArray(result?.branches) ? result.branches : []
  } catch {
    return []
  }
}

export async function remoteAssignBranch(
  host: EnvironmentHost,
  folderPath: string,
  worktreePath: string,
  name: string,
): Promise<WorktreeAssignResult> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, reason: 'error', error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, reason: 'error', error: 'environment is not connected' }
  try {
    return (await gw.gitWorktreeAssignBranch(
      ctx.projectId,
      hostPathOf(worktreePath),
      name,
    )) as WorktreeAssignResult
  } catch (err) {
    return { ok: false, reason: 'error', error: (err as Error).message }
  }
}

export async function remoteHandoffToMain(
  host: EnvironmentHost,
  folderPath: string,
  worktreePath: string,
): Promise<WorktreeHandoffResult> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, reason: 'error', error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, reason: 'error', error: 'environment is not connected' }
  try {
    const result = (await gw.gitWorktreeHandoff(
      ctx.projectId,
      hostPathOf(worktreePath),
    )) as {
      ok: boolean
      reason?: string
      error?: string
    }
    if (result.ok) return { ok: true }
    // Map main-dirty → local-dirty for existing UI copy keys.
    const reason = result.reason === 'main-dirty' ? 'local-dirty' : result.reason
    return {
      ok: false,
      reason: (reason as WorktreeHandoffResult extends { ok: false; reason: infer R } ? R : never) || 'error',
      error: result.error,
    }
  } catch (err) {
    return { ok: false, reason: 'error', error: (err as Error).message }
  }
}

export async function remoteHandoffPreview(
  host: EnvironmentHost,
  folderPath: string,
  worktreePath: string,
): Promise<GitDirtyStatus | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return null
  try {
    const result = (await gw.gitWorktreeHandoffPreview(
      ctx.projectId,
      hostPathOf(worktreePath),
    )) as GitDirtyStatus | null
    return result
  } catch {
    return null
  }
}

export async function remoteSetSessionCwd(
  host: EnvironmentHost,
  connectionId: string,
  sessionId: string,
  cwdHostPath: string | null,
): Promise<void> {
  await host.setSessionCwd(connectionId, sessionId, cwdHostPath)
}

/**
 * Switch or create a branch on the remote project (or a worktree if folderPath is a wt key).
 * When folderPath is the project remote key, operates at project root.
 * When folderPath is a worktree remote key under the same connection, pass cwd=host wt path —
 * but resolveRemoteProjectContext expects a registered project path, so callers should pass
 * the **project** key as folderPath and optional worktree host cwd separately if needed.
 */
export async function remoteSwitchBranch(
  host: EnvironmentHost,
  folderPath: string,
  branch: string,
  create = false,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return { ok: false, error: 'not a remote project' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, error: 'environment is not connected' }
  let safeBranch: string
  try {
    safeBranch = sanitizeGitRef(branch)
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'invalid branch name' }
  }
  try {
    // If folderPath host path differs from project root, treat as worktree cwd.
    const pathPart = hostPathOf(folderPath)
    const atWorktree = pathPart.replace(/\/$/, '') !== ctx.hostPath.replace(/\/$/, '')
    const result = (await gw.gitSwitchBranch(ctx.projectId, safeBranch, {
      create,
      ...(atWorktree ? { cwd: pathPart } : {}),
    })) as { ok?: boolean; error?: string }
    if (result && result.ok === false) {
      return { ok: false, error: result.error || 'branch operation failed' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'branch operation failed' }
  }
}

type NodeGitFailure = { ok: false; reason: 'unsupported' | 'unavailable' | 'error'; error?: string }

/** The project's node gateway when it serves `method`. */
async function nodeGit(
  host: EnvironmentHost,
  folderPath: string,
  method: string,
): Promise<{ ok: true; gw: RemoteEnvironmentGateway; projectId: string; connectionId: string } | NodeGitFailure> {
  const ctx = await resolveRemoteProjectContext(host, folderPath, { registerIfMissing: false }).catch(() => null)
  if (!ctx) return { ok: false, reason: 'unavailable' }
  const gw = asRemoteGw(host, ctx.environmentId)
  if (!gw) return { ok: false, reason: 'unavailable' }
  if (!servesMethod((await gw.getDescriptor()).capabilities, method)) return { ok: false, reason: 'unsupported' }
  return { ok: true, gw, projectId: ctx.projectId, connectionId: ctx.connectionId }
}

/** Recent branches of a node checkout (`git.branchTips`). */
export async function remoteBranchTips(
  host: EnvironmentHost,
  folderPath: string,
): Promise<{ ok: true; branches: BranchTip[] } | NodeGitFailure> {
  try {
    const node = await nodeGit(host, folderPath, 'git.branchTips')
    if (!node.ok) return node
    return { ok: true, branches: (await node.gw.gitBranchTips(node.projectId)).branches }
  } catch (err) {
    return { ok: false, reason: 'error', error: (err as Error).message }
  }
}

export interface NodeBranchBundle {
  /** Local copy of the bundle; null when the receiver already had every commit. */
  bundlePath: string | null
  branch: string
  head: string
  snapshot: string | null
}

/** Progress and cancellation for one checkout; cancelling stops between chunks and before landing. */
export interface TransferControl {
  signal?: AbortSignal
  onProgress?: (phase: CheckoutProgressPhase, done?: number, total?: number) => void
}

function unsupportedError(): Error {
  return Object.assign(new Error('environment does not support this'), { code: 'unsupported' })
}

/** The node gateway for `method`, or a thrown error naming why not. */
async function requireNodeGit(host: EnvironmentHost, folderPath: string, method: string) {
  const node = await nodeGit(host, folderPath, method)
  if (node.ok) return node
  if (node.reason === 'unsupported') throw unsupportedError()
  throw Object.assign(new Error(node.error ?? 'environment is not connected'), { code: 'unavailable' })
}

/**
 * Have the node bundle `branch` against the receiver's `haves`, copy the bundle
 * over the node's temp-file reads, and hand it to `use`. No shared git remote
 * is involved; the local copy is removed afterwards.
 */
export async function withRemoteBranchBundle(
  host: EnvironmentHost,
  input: { folderPath: string; branch: string; haves: string[]; includeWorkingTree: boolean },
  use: (bundle: NodeBranchBundle) => Promise<BranchImportResult>,
  control: TransferControl = {},
): Promise<BranchImportResult> {
  const node = await requireNodeGit(host, input.folderPath, 'git.exportBundle')
  control.onProgress?.('bundling')
  const exported = await node.gw.gitExportBundle({
    projectId: node.projectId,
    branch: input.branch,
    haves: input.haves,
    includeWorkingTree: input.includeWorkingTree,
  })
  if (!exported.ok) return { ok: false, reason: exported.reason, error: exported.error }
  if (control.signal?.aborted) throw transferCancelledError()

  let bundlePath: string | null = null
  if (exported.bundlePath) {
    control.onProgress?.('downloading', 0, exported.size)
    const copy = await host.resolveRemoteTempFile(node.connectionId, exported.bundlePath, {
      signal: control.signal,
      onProgress: (done, total) => control.onProgress?.('downloading', done, total),
    })
    if (copy.kind !== 'local') return { ok: false, reason: 'unsupported', error: `bundle transfer: ${copy.kind}` }
    bundlePath = copy.path
  }
  try {
    return await use({ bundlePath, branch: exported.branch, head: exported.head, snapshot: exported.snapshot })
  } finally {
    if (bundlePath) rmSync(bundlePath, { force: true })
  }
}

/** Commits a node checkout already has, so a sender bundles only the rest. */
export async function remoteBundleHaves(host: EnvironmentHost, folderPath: string): Promise<string[]> {
  const node = await requireNodeGit(host, folderPath, 'git.bundleHaves')
  return (await node.gw.gitBundleHaves(node.projectId)).haves
}

/** Where incoming tips stand against a node checkout's branches. */
export async function remoteBranchRelations(
  host: EnvironmentHost,
  folderPath: string,
  items: Array<{ localName: string; head: string }>,
): Promise<Array<{ relation: BranchRelation; behind?: number }>> {
  const node = await requireNodeGit(host, folderPath, 'git.branchRelations')
  return (await node.gw.gitBranchRelations(node.projectId, items)).relations
}

/**
 * Send a local bundle to a node checkout in temp-file-sized chunks, then have
 * the node land it. An upload cancelled half way expires on the node.
 */
export async function landOnRemote(
  host: EnvironmentHost,
  folderPath: string,
  incoming: {
    bundlePath: string | null
    localName: string
    head: string
    snapshot: string | null
    onDiverged?: 'stop' | 'overwrite'
    createOnly?: boolean
  },
  control: TransferControl = {},
): Promise<BranchImportResult> {
  const node = await requireNodeGit(host, folderPath, 'git.applyIncomingBranch')
  let upload: { uploadId: string; size: number } | null = null
  if (incoming.bundlePath) {
    const size = statSync(incoming.bundlePath).size
    const uploadId = randomUUID()
    const fd = openSync(incoming.bundlePath, 'r')
    try {
      const buffer = Buffer.alloc(TEMP_FILE_CHUNK_BYTES)
      control.onProgress?.('uploading', 0, size)
      for (let offset = 0; offset < size;) {
        if (control.signal?.aborted) throw transferCancelledError()
        const read = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset)
        if (read <= 0) throw new Error('bundle changed during upload')
        await node.gw.gitUploadBundle({ projectId: node.projectId, uploadId, offset, chunk: buffer.subarray(0, read).toString('base64') })
        offset += read
        control.onProgress?.('uploading', offset, size)
      }
    } finally {
      closeSync(fd)
    }
    upload = { uploadId, size }
  }
  if (control.signal?.aborted) throw transferCancelledError()
  control.onProgress?.('applying')
  return node.gw.gitApplyIncomingBranch({
    projectId: node.projectId,
    upload,
    localName: incoming.localName,
    head: incoming.head,
    snapshot: incoming.snapshot,
    ...(incoming.onDiverged ? { onDiverged: incoming.onDiverged } : {}),
    ...(incoming.createOnly ? { createOnly: true } : {}),
  })
}
