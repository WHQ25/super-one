import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, View } from 'react-native'
import { useMobileTheme } from '../theme/context'
import { useIconMotion } from './use-icon-motion'
import { Text } from './text'

const SIZE = 32
const PULSE_MS = 900

export type RepoOwnerAvatarStatus = 'loading' | 'ready' | 'failed'

/** Owner avatar: skeleton while the image loads, owner initial only if it fails. */
export function RepoOwnerAvatar({ owner, uri, status: pinned }: {
  owner: string
  uri: string
  /** Pin the face for stories; production infers it from the image. */
  status?: RepoOwnerAvatarStatus
}) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [result, setResult] = useState<{ uri: string; ok: boolean } | null>(null)
  const inferred: RepoOwnerAvatarStatus = result?.uri !== uri ? 'loading' : result.ok ? 'ready' : 'failed'
  const status = pinned ?? inferred
  return (
    <View style={{ width: SIZE, height: SIZE, flexShrink: 0, borderRadius: radius.sm, overflow: 'hidden',
      alignItems: 'center', justifyContent: 'center' }}>
      <Image key={uri} source={{ uri }} accessible={false} testID="repo-owner-avatar-image"
        onLoad={() => setResult({ uri, ok: true })} onError={() => setResult({ uri, ok: false })}
        style={{ position: 'absolute', width: SIZE, height: SIZE, opacity: status === 'failed' ? 0 : 1 }} />
      {status === 'loading' ? <AvatarSkeleton fill={colors.muted} sheen={colors.foreground} /> : null}
      {status === 'failed' ? (
        <View style={{ position: 'absolute', width: SIZE, height: SIZE, backgroundColor: colors.muted,
          alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.mutedForeground }}>
            {owner.charAt(0).toUpperCase()}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function AvatarSkeleton({ fill, sheen }: { fill: string; sheen: string }) {
  const animate = useIconMotion()
  const shine = useRef(new Animated.Value(0.08)).current
  useEffect(() => {
    if (!animate) return
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(shine, { toValue: 0.18, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(shine, { toValue: 0.08, duration: PULSE_MS, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]))
    loop.start()
    return () => {
      loop.stop()
      shine.setValue(0.08)
    }
  }, [animate, shine])
  return (
    <View testID="repo-owner-avatar-skeleton" accessible={false} pointerEvents="none"
      style={{ position: 'absolute', width: SIZE, height: SIZE, backgroundColor: fill }}>
      <Animated.View style={{ flex: 1, backgroundColor: sheen, opacity: shine }} />
    </View>
  )
}
