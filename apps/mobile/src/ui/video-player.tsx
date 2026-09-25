import { useEvent } from 'expo'
import { VideoView, useVideoPlayer } from 'expo-video'
import { CircleAlert } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'
import { FILE_PREVIEW_TEXT } from '../file-preview-state'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { Text } from './text'

/**
 * The body a downloaded clip plays in: the platform player over the cache
 * file, with its own transport controls, fullscreen and scrubbing. Playback
 * starts on its own — the user tapped a poster to get here, so the first
 * thing they should see is the clip moving, not a second play button.
 *
 * Failure is the one state the native controls do not report: a container
 * the platform decoder rejects sits on a black view forever. The player's
 * `status` covers it, and the message sits where the frame would be.
 */
export function VideoPlayerView({ uri, label }: { uri: string; label: string }) {
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false
    instance.play()
  })
  const { status } = useEvent(player, 'statusChange', { status: player.status })

  return (
    <View style={[styles.body, { backgroundColor: colors.background }]} testID="file-preview-video">
      {status === 'error' ? (
        <View style={styles.error}>
          <CircleAlert color={colors.error} size={28} />
          <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 13, textAlign: 'center' }}>{t(FILE_PREVIEW_TEXT.videoFailed)}</Text>
        </View>
      ) : (
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls
          allowsFullscreen
          allowsPictureInPicture={false}
          accessibilityLabel={label}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  video: { flex: 1 },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 },
})
