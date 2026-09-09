import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Wifi, WifiHigh, WifiLow, WifiZero, type LucideIcon } from 'lucide-react-native'
import { useIconMotion } from './use-icon-motion'

export const WIFI_CYCLE_FRAME_MS = 250

const FRAMES: { id: 'zero' | 'low' | 'high' | 'full'; icon: LucideIcon }[] = [
  { id: 'zero', icon: WifiZero },
  { id: 'low', icon: WifiLow },
  { id: 'high', icon: WifiHigh },
  { id: 'full', icon: Wifi },
]

/**
 * Lucide wifi strength cycling in place of a spin. Same motion gate as
 * `SpinningIcon`: Reduce Motion and a backgrounded app stay on wifi-zero.
 */
export function WifiCycleIcon(props: {
  size: number
  color: string
  strokeWidth?: number
}) {
  const animate = useIconMotion()
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!animate) return
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % FRAMES.length)
    }, WIFI_CYCLE_FRAME_MS)
    return () => {
      clearInterval(timer)
      setFrame(0)
    }
  }, [animate])

  const current = FRAMES[frame]
  const Icon = current.icon
  return (
    <View testID={`wifi-cycle-${current.id}`} accessible={false}>
      <Icon color={props.color} size={props.size} strokeWidth={props.strokeWidth} />
    </View>
  )
}
