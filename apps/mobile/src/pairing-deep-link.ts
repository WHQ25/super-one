import { useEffect, useRef } from 'react'
import { Linking } from 'react-native'
import { isAnyPairingInput } from './pairing-input'

export function usePairingDeepLink(onPair: (url: string) => void | Promise<void>): void {
  const onPairRef = useRef(onPair)
  onPairRef.current = onPair

  useEffect(() => {
    let active = true
    const openPairingLink = (url: string) => {
      if (isAnyPairingInput(url)) void onPairRef.current(url)
    }
    const subscription = Linking.addEventListener('url', ({ url }) => openPairingLink(url))
    void Linking.getInitialURL().then((url) => {
      if (active && url) openPairingLink(url)
    })
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
}
