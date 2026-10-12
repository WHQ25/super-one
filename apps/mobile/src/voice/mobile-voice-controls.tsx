import { AudioLines, Mic, MicOff, Power, Pause, Play, RotateCcw, Settings } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconButton } from '../ui/icon-button'
import { Text } from '../ui/text'
import { useMobileTheme } from '../theme/context'
import { useMobileLocale } from '../i18n/context'
import { useKeyboardVisible } from '../ui/use-keyboard-visible'
import { COMPOSER_HORIZONTAL_INSET, COMPOSER_TOP_GAP, PHONE_COMPOSER_RADIUS, composerBottomGap } from '../ui/composer-frame'
import type { MobileVoiceState } from './voice-service'
import type { VoiceAudioLevelSource } from './voice-audio-levels'
import { VoiceWaveform } from './voice-waveform'

export function MobileVoiceEntry(props: { enabled: boolean; busy: boolean; onStart: () => void; disabledReason?: string }) {
  return <IconButton icon={AudioLines} label={props.enabled ? 'Start voice' : props.disabledReason ?? 'Rebuild the mobile app to enable voice.'}
    disabled={!props.enabled || props.busy} onPress={props.onStart} />
}

/** A live call stays reachable in the text composer, including other conversations. */
export function MobileVoiceReturnEntry({ audioLevels, onReturn, paused = false }: { audioLevels?: VoiceAudioLevelSource; onReturn: () => void; paused?: boolean }) {
  const { t } = useMobileLocale()
  return <Pressable testID="mobile-voice-return" accessibilityRole="button" accessibilityLabel={t('Return to voice conversation')}
    onPress={onReturn} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
    <VoiceWaveform levels={audioLevels} compact paused={paused} />
  </Pressable>
}

export type MobileVoiceControlsProps = {
  state: MobileVoiceState; onStop: () => void; onInputMute: () => void
  onPlayback: () => void
  audioLevels?: VoiceAudioLevelSource
  onRetry: () => void; onSettings: () => void
}
export function MobileVoiceControls(props: MobileVoiceControlsProps) {
  const { state } = props
  const { tokens: { colors } } = useMobileTheme()
  const { t } = useMobileLocale()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible()
  if (state.phase === 'idle') return null
  const active = state.phase === 'active'
  const pending = state.phase === 'starting' || state.phase === 'stopping'
  const label = state.phase === 'starting' ? 'Starting voice session…' : state.phase === 'stopping' ? 'Hanging up'
    : active ? (state.paused ? (state.error ?? (state.pauseReason === 'interrupted' ? 'Audio interrupted. Tap Play to continue.' : 'Voice paused')) : state.inputMuted ? 'Microphone muted' : 'Listening') : state.phase === 'denied' ? 'Microphone access denied' : 'Voice could not connect'
  return <View style={{ paddingHorizontal: COMPOSER_HORIZONTAL_INSET, paddingTop: COMPOSER_TOP_GAP,
    paddingBottom: composerBottomGap(keyboardVisible, insets.bottom), backgroundColor: colors.background }}>
    <View testID="mobile-voice-controls" style={{ paddingHorizontal: 6, paddingVertical: 3, borderWidth: 1,
      borderColor: colors.border, borderRadius: PHONE_COMPOSER_RADIUS, flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: 2 }}>
    {state.phase === 'error' || state.phase === 'denied' ? <IconButton icon={state.phase === 'denied' ? Settings : RotateCcw}
      label={state.phase === 'denied' ? 'Open Settings' : 'Retry voice'} onPress={state.phase === 'denied' ? props.onSettings : props.onRetry} />
      : <IconButton icon={state.inputMuted ? MicOff : Mic} label={state.inputMuted ? 'Unmute microphone' : 'Mute microphone'}
        active={state.inputMuted} color={colors.foreground} disabled={!active} onPress={props.onInputMute} />}
    <View testID="mobile-voice-status" accessible={active} accessibilityRole={active ? 'image' : undefined} accessibilityLabel={active ? t(label) : undefined}
      style={{ flex: 1, minWidth: 0, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
      {active ? <View style={{ flex: 1 }}><VoiceWaveform levels={props.audioLevels} paused={state.paused} />
        {state.paused ? <Text accessibilityLiveRegion="polite" numberOfLines={1} style={{ fontSize: 10, color: colors.foreground, textAlign: 'center', marginTop: -8 }}>{t(label)}</Text> : null}
      </View> : <Text accessibilityLiveRegion="polite" accessibilityLabel={t(state.error ?? label)} numberOfLines={1}
        style={{ flexShrink: 1, minWidth: 0, fontSize: 12, textAlign: 'center', color: state.error ? colors.error : colors.foreground }}>{t(state.error ?? label)}</Text>
      }
    </View>
    <IconButton icon={state.paused ? Play : Pause} label={state.paused ? 'Resume voice' : 'Pause voice'}
      color={colors.foreground} disabled={!active || state.resuming} onPress={props.onPlayback} />
    <IconButton icon={Power} label={pending ? 'Cancel voice' : 'End voice'} chrome="plain" color="#fff" iconSize={16}
      style={{ width: 32, height: 32, marginHorizontal: 6, borderRadius: 16, backgroundColor: colors.error }} hitSlop={6}
      disabled={state.phase === 'stopping'} onPress={props.onStop} />
    </View>
  </View>
}
