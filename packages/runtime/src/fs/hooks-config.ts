/**
 * Claude hooks config (settings.json#hooks) — electron-free.
 * Parity with desktop `hooks-config-service`.
 */

import type {
  HookConfig,
  HookEntry,
  HookEventName,
  HookSavePayload,
  HookScope,
} from '@superone/shared/agent-types'
import {
  getLocalSettingsPath,
  getProjectSettingsPath,
  getUserSettingsPath,
  readJsonObject,
  writeSettingsJson,
} from './claude-settings-files'

export interface HooksConfigOptions {
  /** Override home (tests / node isolation). Default: os.homedir(). */
  homeDir?: string
}

function pathFor(scope: HookScope, cwd: string, opts?: HooksConfigOptions): string {
  if (scope === 'user') return getUserSettingsPath(opts)
  if (scope === 'project') return getProjectSettingsPath(cwd)
  return getLocalSettingsPath(cwd)
}

interface MatcherGroup {
  matcher?: string
  hooks: HookEntry[]
}

type HooksMap = Record<string, MatcherGroup[]>

function getHooksMap(data: Record<string, unknown>): HooksMap {
  const h = data.hooks
  if (!h || typeof h !== 'object' || Array.isArray(h)) return {}
  return h as HooksMap
}

function makeId(scope: HookScope, event: string, gIdx: number, eIdx: number): string {
  return `${scope}:${event}:${gIdx}:${eIdx}`
}

interface ParsedId {
  scope: HookScope
  event: HookEventName
  gIdx: number
  eIdx: number
}

function parseId(id: string): ParsedId | null {
  const parts = id.split(':')
  if (parts.length !== 4) return null
  const [scope, event, gIdxStr, eIdxStr] = parts
  if (scope !== 'user' && scope !== 'project' && scope !== 'local') return null
  const gIdx = Number.parseInt(gIdxStr!, 10)
  const eIdx = Number.parseInt(eIdxStr!, 10)
  if (Number.isNaN(gIdx) || Number.isNaN(eIdx)) return null
  return { scope, event: event as HookEventName, gIdx, eIdx }
}

export function listHooks(cwd: string, opts?: HooksConfigOptions): HookConfig[] {
  const result: HookConfig[] = []
  const scopes: HookScope[] = ['user', 'project', 'local']
  for (const scope of scopes) {
    const data = readJsonObject(pathFor(scope, cwd, opts))
    const hooks = getHooksMap(data)
    for (const event of Object.keys(hooks)) {
      const groups = hooks[event] ?? []
      groups.forEach((group, gIdx) => {
        const entries = Array.isArray(group?.hooks) ? group.hooks : []
        entries.forEach((entry, eIdx) => {
          result.push({
            id: makeId(scope, event, gIdx, eIdx),
            scope,
            event: event as HookEventName,
            matcher: group.matcher,
            entry,
          })
        })
      })
    }
  }
  return result
}

export function saveHook(
  cwd: string,
  payload: HookSavePayload,
  replaceId?: string,
  opts?: HooksConfigOptions,
): void {
  if (replaceId) {
    deleteHook(cwd, replaceId, opts)
  }
  const filePath = pathFor(payload.scope, cwd, opts)
  const data = readJsonObject(filePath)
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) {
    data.hooks = {}
  }
  const hooks = data.hooks as HooksMap
  if (!Array.isArray(hooks[payload.event])) {
    hooks[payload.event] = []
  }
  const groups = hooks[payload.event]!
  const matcherKey = payload.matcher ?? ''
  let group = groups.find((g) => (g?.matcher ?? '') === matcherKey)
  if (!group) {
    group = payload.matcher ? { matcher: payload.matcher, hooks: [] } : { hooks: [] }
    groups.push(group)
  }
  if (!Array.isArray(group.hooks)) group.hooks = []
  group.hooks.push(payload.entry)
  writeSettingsJson(filePath, data)
}

export function deleteHook(cwd: string, id: string, opts?: HooksConfigOptions): void {
  const parsed = parseId(id)
  if (!parsed) return
  const { scope, event, gIdx, eIdx } = parsed
  const filePath = pathFor(scope, cwd, opts)
  const data = readJsonObject(filePath)
  const hooks = getHooksMap(data)
  const groups = hooks[event]
  if (!Array.isArray(groups) || !groups[gIdx]) return
  const group = groups[gIdx]!
  if (!Array.isArray(group.hooks) || group.hooks.length <= eIdx) return

  group.hooks.splice(eIdx, 1)
  if (group.hooks.length === 0) groups.splice(gIdx, 1)
  if (groups.length === 0) delete hooks[event]
  if (Object.keys(hooks).length === 0) {
    delete data.hooks
  } else {
    data.hooks = hooks
  }
  writeSettingsJson(filePath, data)
}
