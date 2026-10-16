import type { SessionAgentLaunchSettings, SessionAgentProfile } from './agent-types'
import type { SuggestedTaskLaunchChoice } from './suggested-task'
import { HARNESS_LAUNCH_OPTIONS } from './launch-options'
import { supportsClaudeFastMode } from './claude-fast-mode'
import { findCodexFastServiceTier } from './codex-fast-mode'

export const SUGGESTED_TASK_SETTING_KEYS = ['model', 'effort', 'apiProviderId', 'permissionMode', 'sandboxMode', 'fastMode', 'claudeFastMode'] as const satisfies readonly (keyof SessionAgentLaunchSettings)[]

/** The only client-editable fields; the source host always owns the task and cwd. */
export function suggestedTaskSettings(settings: SessionAgentLaunchSettings): SessionAgentLaunchSettings {
  return Object.fromEntries(SUGGESTED_TASK_SETTING_KEYS.flatMap(key => settings[key] === undefined ? [] : [[key, settings[key]]]))
}

/** Optional run settings from another model/host must never prevent a task launch. */
export function suggestedTaskRunSettings(profile: SessionAgentProfile, settings: SessionAgentLaunchSettings, codexFast = true): SessionAgentLaunchSettings {
  const picked = suggestedTaskSettings(settings)
  const model = profile.models.find(model => model.id === (picked.model ?? profile.defaultConfig.model))
  const modelEnv = profile.apiProviders.find(provider => provider.id === (picked.apiProviderId ?? profile.defaultConfig.apiProviderId))?.modelEnv
  if (profile.harnessId !== 'codex' || !codexFast || !findCodexFastServiceTier(model)) delete picked.fastMode
  if (profile.harnessId !== 'claude' || !supportsClaudeFastMode(model, modelEnv)) delete picked.claudeFastMode
  if (picked.effort && profile.efforts.length && !profile.efforts.includes(picked.effort)) delete picked.effort
  return picked
}

export function suggestedTaskInitialChoice(profiles: SessionAgentProfile[], providerId: string, settings: SessionAgentLaunchSettings): SuggestedTaskLaunchChoice | null {
  const own = profiles.find(profile => profile.id === providerId)
  if (!own) return profiles[0] ? { agentId: profiles[0].id, settings: {} } : null
  const picked = suggestedTaskSettings(settings)
  if (picked.apiProviderId && !own.apiProviders.some(provider => provider.id === picked.apiProviderId)) delete picked.apiProviderId
  return { agentId: own.id, settings: picked }
}

export function suggestedTaskBranchName(title: string, taskId: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
  const id = taskId.replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return `task/${slug ? `${slug}-` : ''}${id}`
}

export function parseSuggestedTaskChoice(value: unknown): SuggestedTaskLaunchChoice | undefined {
  const invalid = (message: string): never => { throw Object.assign(new Error(message), { code: 'invalid_argument' }) }
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('invalid task launch choice')
  const { agentId, settings } = value as Record<string, unknown>
  if (typeof agentId !== 'string' || !agentId.trim() || !settings || typeof settings !== 'object' || Array.isArray(settings)) return invalid('task launch needs an agent and settings')
  const input = settings as Record<string, unknown>
  const picked: SessionAgentLaunchSettings = {}
  for (const key of SUGGESTED_TASK_SETTING_KEYS) {
    const entry = input[key]
    if (entry === undefined) continue
    const valid = key === 'fastMode' || key === 'claudeFastMode' ? typeof entry === 'boolean' : (key === 'apiProviderId' && entry === null) || typeof entry === 'string'
    if (!valid) return invalid(`invalid task launch ${key}`)
    if (key === 'permissionMode' && !Object.values(HARNESS_LAUNCH_OPTIONS).some(option => option.permissionModes.some(mode => mode === entry))) return invalid('invalid permission mode')
    if (key === 'sandboxMode' && !Object.values(HARNESS_LAUNCH_OPTIONS).some(option => option.sandboxModes.some(mode => mode === entry))) return invalid('invalid sandbox mode')
    Object.assign(picked, { [key]: entry })
  }
  return { agentId, settings: picked }
}
