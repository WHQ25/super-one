import { memo } from 'react'
import { View } from 'react-native'
import type { HarnessId } from '@superone/shared/agent-types'
import { isGrokAcpAgent, isOpenCodeAcpAgent } from '@superone/shared/acp-brand'
import { useMobileTheme } from '../theme/context'
import { HarnessScene, harnessScenes } from './harness-scene'
import type { IconBrand, IconState } from './harness-scene-types'
import { useIconMotion } from './use-icon-motion'

export function sessionIconState(status?: string): IconState {
  if (status === 'running' || status === 'streaming' || status === 'starting') return 'running'
  if (status === 'background' || status === 'unseen' || status === 'automation') return status
  return 'default'
}

export function sessionIconBrand(provider: HarnessId, acpAgentId?: string | null): IconBrand {
  if (provider !== 'acp') return provider
  if (isGrokAcpAgent(acpAgentId)) return 'grok'
  if (isOpenCodeAcpAgent(acpAgentId)) return 'opencode'
  return 'acp'
}

export const HarnessIcon = memo(function HarnessIcon({ provider, acpAgentId, status, size = 20, renderLevel = 'compact' }: {
  provider: HarnessId; acpAgentId?: string | null; status?: string; size?: number; renderLevel?: 'compact' | 'rich'
}) {
  const { tokens } = useMobileTheme()
  const animate = useIconMotion()
  const brand = sessionIconBrand(provider, acpAgentId)
  const node = harnessScenes.scenes[brand][sessionIconState(status)][renderLevel]
  return <View accessible={false} style={{ width: size, height: size, opacity: status === 'ended' || status === 'disposed' ? 0.55 : 1 }}>
    <HarnessScene node={node} size={size} color={tokens.colors.foreground} background={tokens.colors.background} motion={animate} />
  </View>
})
