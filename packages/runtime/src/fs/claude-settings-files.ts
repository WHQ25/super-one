/**
 * Claude Code settings files (`settings.json` layers) — electron-free.
 *
 * Precedence, lowest first: user `~/.claude/settings.json`, project
 * `{cwd}/.claude/settings.json`, local `{cwd}/.claude/settings.local.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir as osHomedir } from 'node:os'

export interface ClaudeSettingsFileOptions {
  /** Override home (tests / node isolation). Default: os.homedir(). */
  homeDir?: string
}

export function getUserSettingsPath(opts?: ClaudeSettingsFileOptions): string {
  return join(opts?.homeDir ?? osHomedir(), '.claude', 'settings.json')
}

export function getProjectSettingsPath(cwd: string): string {
  return join(cwd, '.claude', 'settings.json')
}

export function getLocalSettingsPath(cwd: string): string {
  return join(cwd, '.claude', 'settings.local.json')
}

/** Settings files that apply to `cwd`, lowest precedence first. */
export function settingsLayers(cwd: string, opts?: ClaudeSettingsFileOptions): string[] {
  return cwd
    ? [getUserSettingsPath(opts), getProjectSettingsPath(cwd), getLocalSettingsPath(cwd)]
    : [getUserSettingsPath(opts)]
}

/** The file's top-level object; `{}` when missing, unreadable or not an object. */
export function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

export function writeSettingsJson(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
}
