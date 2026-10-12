import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { ScheduledSendControls } from '../navigation/use-scheduled-send'
import { parseScheduledSendTime, scheduledSendFields, formatScheduledSendTime } from '../scheduled-send-time'
import { useMobileLocale } from '../i18n/context'
import { useMobileTheme } from '../theme/context'
import { MenuTextInput } from './anchored-menu'
import { Text } from './text'

/** Small reusable action used by the panel and the quota-recovery card. */
export function ScheduledSendAction({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { t } = useMobileLocale()
  return <Pressable accessibilityRole="button" accessibilityLabel={t(label)} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 44, flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, borderRadius: radius.md,
      backgroundColor: pressed ? colors.border : colors.muted, opacity: disabled ? 0.4 : 1 })}>
    <Text style={{ color: primary ? colors.primary : colors.foreground, fontSize: 13, fontWeight: '500' }}>{t(label)}</Text>
  </Pressable>
}

export function ScheduledSendPanel({ controls, onClose, canArm = true }: { controls: ScheduledSendControls; onClose: () => void; canArm?: boolean }) {
  const { tokens: { colors, radius } } = useMobileTheme()
  const { locale, t } = useMobileLocale()
  const initial = scheduledSendFields(controls.scheduled?.sendAt ?? Date.now() + 3_600_000)
  const [day, setDay] = useState(initial.day)
  const [time, setTime] = useState(initial.time)
  const sendAt = parseScheduledSendTime(day, time)
  const valid = sendAt !== null && sendAt > Date.now()
  const disabled = !controls.available || controls.busy
  const fieldStyle = { color: colors.foreground, fontSize: 15, minHeight: 44, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }
  const preset = (offset: number) => {
    const fields = scheduledSendFields(Date.now() + offset)
    setDay(fields.day); setTime(fields.time)
  }
  return <View style={{ padding: 8, gap: 10 }}>
    {controls.scheduled?.armed ? <Text style={{ color: colors.warning, fontSize: 13 }}>
      {`${t('Scheduled send')}: ${formatScheduledSendTime(controls.scheduled.sendAt, locale)}`}
    </Text> : null}
    {controls.scheduled?.message ? <Text numberOfLines={3} style={{ color: colors.foreground, fontSize: 13 }}>{controls.scheduled.message}</Text> : null}
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 3, gap: 4 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Date')}</Text>
        <MenuTextInput accessibilityLabel={t('Scheduled date')} placeholder="YYYY-MM-DD" placeholderTextColor={colors.mutedForeground}
          value={day} onChangeText={setDay} editable={!disabled} autoCorrect={false} maxLength={10} style={fieldStyle} />
      </View>
      <View style={{ flex: 2, gap: 4 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{t('Time')}</Text>
        <MenuTextInput accessibilityLabel={t('Scheduled time')} placeholder="HH:mm" placeholderTextColor={colors.mutedForeground}
          value={time} onChangeText={setTime} editable={!disabled} autoCorrect={false} maxLength={5} style={fieldStyle} />
      </View>
    </View>
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <ScheduledSendAction label="In 1 Hour" onPress={() => preset(3_600_000)} disabled={disabled} />
      <ScheduledSendAction label="In 24 Hours" onPress={() => preset(86_400_000)} disabled={disabled} />
    </View>
    <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 17 }}>{t('Your draft stays editable until the scheduled message is sent. Keep the desktop online.')}</Text>
    {!valid ? <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12 }}>{t('Choose a future date and time')}</Text> : null}
    {controls.error ? <Text accessibilityRole="alert" style={{ color: colors.error, fontSize: 12 }}>{controls.error}</Text> : null}
    {controls.error && controls.retry ? <ScheduledSendAction label="Retry" disabled={controls.busy} onPress={() => { void controls.retry?.().catch(() => {}) }} /> : null}
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {controls.scheduled?.armed ? <ScheduledSendAction label="Cancel Scheduled Send" disabled={disabled}
        onPress={() => { void controls.cancel().then(onClose).catch(() => {}) }} /> : null}
      <ScheduledSendAction label={controls.busy ? 'Saving…' : 'Schedule Send'} primary disabled={disabled || !valid || !canArm}
        onPress={() => { if (sendAt !== null) void controls.schedule(sendAt).then(onClose).catch(() => {}) }} />
    </View>
  </View>
}
