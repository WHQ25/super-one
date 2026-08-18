import { parseRemoteProjectKey } from './remote-project-key'

type AdditionalDirsProvider = 'claude' | 'codex'

export interface ScopedAdditionalDirs {
  user: string[]
  projectShared: string[]
  projectLocal: string[]
}

export function isRemoteAdditionalDirsProject(projectPath: string): boolean {
  return parseRemoteProjectKey(projectPath) !== null
}

async function resolveRemoteProject(projectPath: string): Promise<{
  connectionId: string
  projectId: string
} | null> {
  const remote = parseRemoteProjectKey(projectPath)
  if (!remote) return null
  const projects = await window.environment.listProjects(remote.connectionId, { refresh: false })
  const hit = projects.find((project) => project.path === remote.path)
  const projectId = hit?.projectId
    ?? (await window.environment.openProject(remote.connectionId, remote.path, { createIfMissing: true })).projectId
  return { connectionId: remote.connectionId, projectId }
}

export async function readRemoteAdditionalDirs(
  projectPath: string,
  provider: AdditionalDirsProvider,
): Promise<ScopedAdditionalDirs | null> {
  const remote = await resolveRemoteProject(projectPath)
  if (!remote) return null
  return window.environment.listRemoteAdditionalDirs(remote.connectionId, remote.projectId, provider)
}

export async function addRemoteAdditionalDir(
  projectPath: string,
  dir: string,
  provider: AdditionalDirsProvider,
): Promise<boolean> {
  const remote = await resolveRemoteProject(projectPath)
  if (!remote) return false
  await window.environment.addRemoteAdditionalDir(remote.connectionId, remote.projectId, dir, provider)
  return true
}

export async function removeRemoteAdditionalDir(
  projectPath: string,
  dir: string,
  provider: AdditionalDirsProvider,
): Promise<boolean> {
  const remote = await resolveRemoteProject(projectPath)
  if (!remote) return false
  await window.environment.removeRemoteAdditionalDir(remote.connectionId, remote.projectId, dir, provider)
  return true
}
