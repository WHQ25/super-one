import { useEffect, useState } from 'react'
import { requireOptionalNativeModule } from 'expo'
import type { HingePosture } from './layout-state'

type NativeSubscription = { remove: () => void }

type NativeHinge = {
  addListener: (
    event: 'onChange',
    listener: (payload: { status?: string }) => void,
  ) => NativeSubscription
}

const native = requireOptionalNativeModule<NativeHinge>('SuperOneHinge')

function postureOf(status: unknown): HingePosture {
  if (status === 'flat' || status === 'partial' || status === 'closed') return status
  return 'unknown'
}

/**
 * The Duo hinge, when this binary includes the probe.
 *
 * A dev client built before the module, or any phone that has no hinge,
 * stays `unknown`. Layout then follows the window size alone: a drawer in
 * portrait, and a resident 280pt sidebar when the inner panel is landscape.
 */
export function useHingePosture(): HingePosture {
  const [posture, setPosture] = useState<HingePosture>('unknown')
  useEffect(() => {
    if (!native) return
    const subscription = native.addListener('onChange', (payload) => {
      setPosture(postureOf(payload.status))
    })
    return () => subscription.remove()
  }, [])
  return posture
}
