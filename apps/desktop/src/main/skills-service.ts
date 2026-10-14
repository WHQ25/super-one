import { basename, join } from 'path'
import { homedir } from 'os'
import { cpSync, existsSync } from 'fs'
import type { SkillDetail, SkillInfo } from '@superone/shared/agent-types'
import { deleteManagedSkill, getManagedSkill, listManagedSkills, readManagedSkillFile } from '@superone/runtime/fs'

/**
 * Claude and Codex skills on this desktop's disk: the runtime implementation
 * every node client manages too, plus the window's install of a local folder.
 * Codex skill listing goes through its app-server (CodexSkillsRpcService);
 * contents and deletion read the files.
 */

export function listSkills(cwd: string): SkillInfo[] {
  return listManagedSkills('claude', cwd)
}

export function readSkillContent(cwd: string, name: string, sourcePath?: string): SkillDetail | null {
  return getManagedSkill('claude', cwd, name, sourcePath)
}

export function readSkillFile(cwd: string, skillName: string, relativePath: string, sourcePath?: string): string | null {
  return readManagedSkillFile('claude', cwd, skillName, relativePath, sourcePath)
}

export function readCodexSkillContent(cwd: string, name: string, sourcePath?: string): SkillDetail | null {
  return getManagedSkill('codex', cwd, name, sourcePath)
}

export function readCodexSkillFile(cwd: string, skillName: string, relativePath: string, sourcePath?: string): string | null {
  return readManagedSkillFile('codex', cwd, skillName, relativePath, sourcePath)
}

/** Copy a skill folder the user picked into their Claude skills. */
export function installSkill(sourcePath: string): SkillInfo {
  if (!existsSync(join(sourcePath, 'SKILL.md'))) throw new Error('Not a skill folder: SKILL.md is missing')
  const name = basename(sourcePath)
  const dest = join(homedir(), '.claude', 'skills', name)
  cpSync(sourcePath, dest, { recursive: true })
  const { files: _files, ...skill } = getManagedSkill('claude', dest, name, dest)!
  return skill
}

/** Delete a skill by its exact folder (`SkillInfo.sourcePath`), only inside a writable root. */
export function deleteSkill(sourcePath: string, cwd: string): void {
  deleteManagedSkill('claude', cwd, sourcePath)
}

export function deleteCodexSkill(sourcePath: string, cwd: string): void {
  deleteManagedSkill('codex', cwd, sourcePath)
}
