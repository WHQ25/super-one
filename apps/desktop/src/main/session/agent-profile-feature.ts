import { readAgentProfile } from '@superone/shared/agent-profile'
import { readAppSettings } from '../app-settings-service'

export const AGENT_PROFILES_DISABLED_MESSAGE = 'Agent Profiles is experimental. Enable it in Settings → General → Experimental to use it.'

export function isAgentProfilesEnabled(): boolean {
  return readAppSettings().experimentalAgentProfilesEnabled === true
}

export function assertAgentProfilesEnabled(): void {
  if (!isAgentProfilesEnabled()) throw Object.assign(new Error(AGENT_PROFILES_DISABLED_MESSAGE), { code: 'failed_precondition' })
}

export function assertAgentProfileLaunchEnabled(config: unknown): void {
  if (readAgentProfile(config)) assertAgentProfilesEnabled()
}
