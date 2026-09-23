import type { ComponentType } from 'react'
import { StatusBar } from 'expo-status-bar'
import { Platform, StyleSheet, type ViewProps } from 'react-native'
import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { useMobileTheme } from '../theme/context'

type NativeProps = ViewProps & { hidden: boolean }

const NativeView: ComponentType<NativeProps> | null = Platform.OS === 'android'
  && requireOptionalNativeModule('SuperOneWindowStatusBar') ? requireNativeView<NativeProps>('SuperOneWindowStatusBar') : null

/**
 * Hides the status bar from inside a native `Modal`.
 *
 * iOS has one status bar per app (view-controller-based appearance is off), so
 * the stock component reaches it from anywhere; unmounting restores the app's.
 * On Android the modal is a dialog window that copies the activity's bars once
 * when it opens, so the toggle goes through a native view that drives the
 * window it sits in.
 */
export function WindowStatusBar({ hidden }: { hidden: boolean }) {
  const { tokens: { scheme } } = useMobileTheme()
  if (NativeView) return <NativeView hidden={hidden} style={styles.none} />
  return <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} hidden={hidden} animated />
}

const styles = StyleSheet.create({
  none: { position: 'absolute', width: 0, height: 0 },
})
