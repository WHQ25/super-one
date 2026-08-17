import type { RelayKind } from '@superone/shared/agent-types'

export const RELAY_KIND_LABEL_KEY: Record<RelayKind, string> = {
  'new-api': 'resources.providers.relayKindNewApi',
  'one-api': 'resources.providers.relayKindOneApi',
  sub2api: 'resources.providers.relayKindSub2api',
  'openai-compatible': 'resources.providers.relayKindOpenaiCompatible',
}
