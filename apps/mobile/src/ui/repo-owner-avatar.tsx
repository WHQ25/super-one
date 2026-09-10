import { useState } from 'react'
import { Image, View } from 'react-native'
import { useMobileTheme } from '../theme/context'
import { Text } from './text'

/** Keep the owner identifiable while the network image loads or fails. */
export function RepoOwnerAvatar({ owner, uri }: { owner: string; uri: string }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const [loadedUri, setLoadedUri] = useState<string | null>(null)
  const loaded = loadedUri === uri
  return (
    <View style={{ width: 32, height: 32, flexShrink: 0, borderRadius: radius.sm,
      backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {!loaded ? <Text style={{ fontSize: 14, fontWeight: '600', color: colors.mutedForeground }}>
        {owner.charAt(0).toUpperCase()}
      </Text> : null}
      <Image key={uri} source={{ uri }} accessible={false} testID="repo-owner-avatar-image"
        onLoad={() => setLoadedUri(uri)} onError={() => setLoadedUri(null)}
        style={{ position: 'absolute', width: 32, height: 32, opacity: loaded ? 1 : 0 }} />
    </View>
  )
}
