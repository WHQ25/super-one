import { useRef, useState } from 'react'
import { PanResponder, View, type PanResponderInstance } from 'react-native'
import { Text } from './text'
import type { RemoteEffortOption } from '@superone/shared/agent-types'
import { useMobileTheme } from '../theme/context'
import { effortIndexAt, effortStopOffset } from '../model-picker-state'

const THUMB = 28

/** Desktop renders effort as a stepped slider; this is the touch equivalent. */
export function EffortSlider({ label, options, value, onChange, disabled }: {
  label: string; options: RemoteEffortOption[]; value: string
  onChange: (value: string) => void; disabled?: boolean
}) {
  const { tokens: { colors } } = useMobileTheme()
  const [width, setWidth] = useState(0)
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[index]
  const last = options.length - 1
  const stop = (position: number) => effortStopOffset(position, options.length, width, THUMB)
  // The responder is built once, so the handlers reach live props through refs.
  const seek = (x: number) => {
    if (disabled) return
    const next = options[effortIndexAt(x, options.length, width, THUMB)]
    if (next && next.value !== value) onChange(next.value)
  }
  const seekRef = useRef(seek)
  seekRef.current = seek
  const lockedRef = useRef(disabled)
  lockedRef.current = disabled
  const origin = useRef(0)
  const responder = useRef<PanResponderInstance | null>(null)
  if (!responder.current) {
    responder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => !lockedRef.current,
      onMoveShouldSetPanResponder: () => !lockedRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        origin.current = event.nativeEvent.locationX
        seekRef.current(origin.current)
      },
      onPanResponderMove: (_event, gesture) => seekRef.current(origin.current + gesture.dx),
    })
  }
  const step = (delta: number) => {
    const next = options[Math.min(Math.max(index + delta, 0), last)]
    if (next && next.value !== value) onChange(next.value)
  }
  if (options.length < 2) return null
  return <View style={{ paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.primary }}>{selected?.label ?? label}</Text>
    </View>
    <View
      {...responder.current.panHandlers}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityValue={{ min: 0, max: last, now: index, text: selected?.label }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') step(1)
        if (event.nativeEvent.actionName === 'decrement') step(-1)
      }}
      style={{ height: THUMB, justifyContent: 'center', opacity: disabled ? 0.45 : 1 }}
    >
      <View style={{ height: THUMB, borderRadius: THUMB / 2, backgroundColor: colors.muted, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: stop(index), backgroundColor: colors.primary }} />
      </View>
      {options.map((option, position) => <View key={option.value} pointerEvents="none" style={{
        position: 'absolute', width: 6, height: 6, borderRadius: 3, marginLeft: -3, left: stop(position),
        backgroundColor: position < index ? colors.primaryForeground : colors.mutedForeground,
        opacity: position < index ? 0.5 : 0.4,
      }} />)}
      <View pointerEvents="none" style={{
        position: 'absolute', width: THUMB, height: THUMB, borderRadius: THUMB / 2, left: stop(index) - THUMB / 2,
        backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
        shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
      }} />
    </View>
    {selected?.description ? <Text style={{ marginTop: 8, fontSize: 12, lineHeight: 17, color: colors.mutedForeground }}>{selected.description}</Text> : null}
  </View>
}
