import { app } from 'electron'
import { resolveCursorApiKey } from './cursor-auth'
import {
  listCursorCloudAgents as listCloud,
  listCursorLocalAgents as listLocal,
  getCursorAgent as getAgent,
  listCursorAgentMessages as listMessages,
  getCursorRun as getRun,
  cancelCursorRun as cancelRun,
  listCursorRuns as listRuns,
  archiveCursorAgent as archiveAgent,
  unarchiveCursorAgent as unarchiveAgent,
  deleteCursorAgent as deleteAgent,
  listCursorRepositories as listRepos,
  withResumedAgentArtifacts as withArtifacts,
  listCursorArtifacts as listArtifacts,
  downloadCursorArtifact as downloadArtifact,
  type CursorCloudListAgentsOptions,
} from '@superone/cursor'

function withDesktopDefaults<T extends { config?: unknown; resolveApiKey?: (c: unknown) => string | undefined }>(
  options: T,
): T & { resolveApiKey: (c: unknown) => string | undefined } {
  return {
    ...options,
    resolveApiKey: options.resolveApiKey ?? resolveCursorApiKey,
  }
}

function userDataRoot(): string {
  return app.getPath('userData')
}

/** List cloud Cursor agents (desktop decrypts API key). */
export async function listCursorCloudAgents(options: CursorCloudListAgentsOptions = {}) {
  return listCloud(withDesktopDefaults(options))
}

/** List local Cursor agents for a workspace. */
export async function listCursorLocalAgents(options: {
  cwd: string
  limit?: number
  cursor?: string
  store?: import('@cursor/sdk').LocalAgentStore
}) {
  return listLocal({ ...options, userDataRoot: userDataRoot() })
}

/** Fetch a Cursor agent by id. */
export async function getCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown; cwd?: string } = {},
) {
  return getAgent(agentId, {
    ...withDesktopDefaults(options),
    ...(options.cwd ? { userDataRoot: userDataRoot() } : {}),
  })
}

/** List local agent messages. */
export async function listCursorAgentMessages(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    cwd?: string
    limit?: number
    offset?: number
  } = {},
) {
  return listMessages(agentId, {
    ...withDesktopDefaults(options),
    userDataRoot: userDataRoot(),
  })
}

/** Fetch a Cursor run by id. */
export async function getCursorRun(
  runId: string,
  options: {
    agentId?: string
    apiKey?: string
    config?: unknown
    cwd?: string
    runtime?: 'local' | 'cloud'
  } = {},
) {
  return getRun(runId, {
    ...withDesktopDefaults(options),
    userDataRoot: userDataRoot(),
  })
}

/** Cancel a Cursor run. */
export async function cancelCursorRun(
  runId: string,
  options: {
    agentId?: string
    apiKey?: string
    config?: unknown
    cwd?: string
    runtime?: 'local' | 'cloud'
  } = {},
) {
  return cancelRun(runId, {
    ...withDesktopDefaults(options),
    userDataRoot: userDataRoot(),
  })
}

/** List runs for a Cursor agent. */
export async function listCursorRuns(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    runtime?: 'local' | 'cloud'
    cwd?: string
    limit?: number
    cursor?: string
  } = {},
) {
  return listRuns(agentId, {
    ...withDesktopDefaults(options),
    userDataRoot: userDataRoot(),
  })
}

/** Archive a cloud Cursor agent. */
export async function archiveCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown } = {},
) {
  return archiveAgent(agentId, withDesktopDefaults(options))
}

/** Unarchive a cloud Cursor agent. */
export async function unarchiveCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown } = {},
) {
  return unarchiveAgent(agentId, withDesktopDefaults(options))
}

/** Delete a cloud Cursor agent. */
export async function deleteCursorAgent(
  agentId: string,
  options: { apiKey?: string; config?: unknown } = {},
) {
  return deleteAgent(agentId, withDesktopDefaults(options))
}

/** List Git repositories linked to the Cursor account. */
export async function listCursorRepositories(options: {
  apiKey?: string
  config?: unknown
} = {}) {
  return listRepos(withDesktopDefaults(options))
}

/** Artifacts require a live SDKAgent handle — open via resume. */
export async function withResumedAgentArtifacts(
  agentId: string,
  options: {
    apiKey?: string
    config?: unknown
    cwd?: string
    model?: string
  },
  fn: (agent: {
    listArtifacts: () => Promise<import('@cursor/sdk').SDKArtifact[]>
    downloadArtifact: (path: string) => Promise<Buffer>
  }) => Promise<unknown>,
) {
  return withArtifacts(agentId, withDesktopDefaults(options), fn)
}

/** List artifacts for a resumed Cursor agent. */
export async function listCursorArtifacts(
  agentId: string,
  options: { apiKey?: string; config?: unknown; cwd?: string; model?: string } = {},
) {
  return listArtifacts(agentId, withDesktopDefaults(options))
}

/** Download one artifact from a resumed Cursor agent. */
export async function downloadCursorArtifact(
  agentId: string,
  path: string,
  options: { apiKey?: string; config?: unknown; cwd?: string; model?: string } = {},
) {
  return downloadArtifact(agentId, path, withDesktopDefaults(options))
}
