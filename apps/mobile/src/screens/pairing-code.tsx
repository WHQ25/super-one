import { useMemo } from 'react'
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native'
import { Text } from '../ui/text'
import { Button } from '../ui'
import { Wordmark } from '../ui/wordmark'
import { useMobileTheme } from '../theme/context'

const DIGIT_TRACKING = 10

/**
 * Pairing takes over the whole page. Nothing else on the device list describes
 * what the user is doing — reading six digits onto another machine — and the
 * "Pair New Device" action would restart the very handshake they are waiting on.
 */
export function PairingCode(props: { code: string; onCancel: () => void }) {
  const styles = useStyles()
  const { tokens } = useMobileTheme()
  return (
    <View style={styles.page}>
      <View style={styles.center}>
        <Wordmark />
        <Text style={styles.title}>Desktop Pairing Code</Text>
        <View style={styles.codeBox}>
          <Text
            // VoiceOver reads a bare "123456" as a number, which is useless for
            // a code the user has to transcribe.
            accessibilityLabel={props.code.split('').join(' ')}
            style={styles.code}
          >
            {props.code}
          </Text>
        </View>
        <Text style={styles.body}>Enter it in SuperOne on your computer to finish pairing.</Text>
        <View style={styles.waiting}>
          <ActivityIndicator size="small" color={tokens.colors.mutedForeground} />
          <Text style={styles.waitingLabel}>Waiting for desktop confirmation…</Text>
        </View>
      </View>
      <Button label="Cancel" variant="secondary" onPress={props.onCancel} />
    </View>
  )
}

function useStyles() {
  const { tokens } = useMobileTheme()
  return useMemo(() => StyleSheet.create({
    page: {
      flex: 1,
      paddingBottom: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.xl,
    },
    /** Everything the user reads centres; the escape hatch sits at the bottom. */
    center: { flex: 1, justifyContent: 'center' },
    title: {
      color: tokens.colors.foreground,
      fontSize: 18,
      fontWeight: '700',
      marginTop: 24,
      textAlign: 'center',
    },
    codeBox: {
      alignSelf: 'center',
      // Derived from the brand token rather than a fixed orange, so the box
      // follows the active harness hue in both schemes.
      backgroundColor: `${tokens.colors.primary}14`,
      borderColor: tokens.colors.primary,
      borderRadius: 16,
      borderWidth: 1.5,
      marginTop: 24,
      // Tracking adds a trailing gap after the last digit; the extra left
      // padding puts the glyphs back in the middle of the box.
      paddingLeft: 24 + DIGIT_TRACKING,
      paddingRight: 24,
      paddingVertical: 20,
    },
    code: {
      color: tokens.colors.primary,
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      fontSize: 44,
      fontWeight: '700',
      letterSpacing: DIGIT_TRACKING,
      textAlign: 'center',
    },
    body: {
      color: tokens.colors.mutedForeground,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 16,
      textAlign: 'center',
    },
    waiting: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: tokens.spacing.sm,
      justifyContent: 'center',
      marginTop: 32,
    },
    waitingLabel: { color: tokens.colors.mutedForeground, fontSize: 13 },
  }), [tokens])
}
