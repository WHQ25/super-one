import type { HarnessId } from '@superone/shared/agent-types'
import { isGrokAcpAgent, isOpenCodeAcpAgent } from '@superone/shared/acp-brand'
import Svg, { Path, Rect } from 'react-native-svg'
import { useMobileTheme } from '../theme/context'
import { HARNESS_ICON_COLORS as colors, HARNESS_ICON_PATHS as paths } from './harness-icon-data'

export function HarnessIcon(props: {
  provider: HarnessId
  acpAgentId?: string | null
  status?: string
  size?: number
}) {
  const { tokens } = useMobileTheme()
  const size = props.size ?? 20
  const opacity = props.status === 'ended' || props.status === 'disposed' ? 0.55 : 1

  if (props.provider === 'claude') {
    return (
      <Svg accessible={false} height={size} opacity={opacity} viewBox="-3 -3 116 90" width={size}>
        <Path d="M10 0H100V20H110V40H100V60H10V40H0V20H10Z" fill={colors.claude} />
        <Rect fill={tokens.colors.foreground} height="10" width="10" x="20" y="20" />
        <Rect fill={tokens.colors.foreground} height="10" width="10" x="80" y="20" />
      </Svg>
    )
  }
  if (props.provider === 'codex') {
    return (
      <Svg accessible={false} height={size} opacity={opacity} viewBox="1 1 22 22" width={size}>
        <Path d={paths.codexCloud} fill={colors.codex} />
        <Path d={paths.codexSlash} fill={colors.lightGlyph} />
        <Path d={paths.codexUnderscore} fill={colors.lightGlyph} />
      </Svg>
    )
  }

  const acpOpenCode = props.provider === 'acp' && isOpenCodeAcpAgent(props.acpAgentId)
  const acpGrok = props.provider === 'acp' && isGrokAcpAgent(props.acpAgentId)
  if (props.provider === 'opencode' || acpOpenCode) {
    return <MonoMark color={tokens.colors.foreground} path={paths.opencode} size={size} opacity={opacity} />
  }
  if (props.provider === 'cursor') {
    return <MonoMark color={tokens.colors.foreground} path={paths.cursor} size={size} opacity={opacity} />
  }
  if (props.provider === 'dsh') {
    return <MonoMark color={colors.deepseek} path={paths.deepseek} size={size} opacity={opacity} />
  }
  if (acpGrok) {
    return <MonoMark color={tokens.colors.foreground} path={paths.grok} size={size} opacity={opacity} />
  }
  return (
    <Svg accessible={false} height={size} opacity={opacity} viewBox="0 0 24 24" width={size}>
      <Rect fill={colors.acp} height="8" rx="2" width="8" x="3" y="3" />
      <Rect fill={colors.acp} height="8" opacity="0.55" rx="2" width="8" x="13" y="3" />
      <Rect fill={colors.acp} height="8" opacity="0.55" rx="2" width="8" x="3" y="13" />
      <Rect fill={colors.acp} height="8" opacity="0.35" rx="2" width="8" x="13" y="13" />
    </Svg>
  )
}

function MonoMark(props: { color: string; opacity: number; path: string; size: number }) {
  return (
    <Svg accessible={false} height={props.size} opacity={props.opacity} viewBox="0 0 24 24" width={props.size}>
      <Path d={props.path} fill={props.color} fillRule="evenodd" />
    </Svg>
  )
}
