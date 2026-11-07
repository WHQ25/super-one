import type { BuiltinCapabilityId } from './capability-prompt-tags'
import type { EnvironmentMentionCandidate } from './environment-mention'

/** Host-owned composer resources. Missing support never means controller resources. */
export interface MentionCatalog {
  capabilityIds: BuiltinCapabilityId[]
  apps: Array<{
    kind: 'miniapp' | 'desktop-app'
    path: string
    label: string
    aliases?: string[]
    iconDataUri?: string
  }>
  environments?: EnvironmentMentionCandidate[]
}
