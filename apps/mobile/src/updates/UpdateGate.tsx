import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { Kv } from '@superone/relay-client'
import { UpdatePrompt } from '../ui/update-prompt'
import { UpdateStatusProvider } from './update-context'
import { useUpdateCheck } from './use-update-check'
import type { UpdatePorts } from './update-ports'

/**
 * Wraps the whole app so the hard gate can cover it.
 *
 * Mounted in `App.tsx` rather than registered in `mobile-overlays.tsx` for
 * three reasons: `App.tsx` already holds `mobileKv`, so the "never import the
 * encrypted store from a hook" rule costs no prop drilling; `mobile-app.tsx`
 * is long enough already; and the overlays render inside the shell's
 * `SafeAreaView`, which would leave the pairing and onboarding paths reachable
 * underneath a gate that is supposed to stop everything.
 *
 * The children stay mounted under the gate rather than being unmounted --
 * tearing down the relay connection to show a blocking panel would cost a full
 * reconnect for a state the user can only leave by installing a new binary.
 */
export function UpdateGate({
  ports,
  store,
  children,
}: {
  ports: UpdatePorts
  store: Pick<Kv, 'get' | 'set'> | null | undefined
  children: ReactNode
}) {
  const status = useUpdateCheck(ports, store)
  return (
    <View style={{ flex: 1 }}>
      <UpdateStatusProvider value={status}>{children}</UpdateStatusProvider>
      <UpdatePrompt state={status.state} actions={status.actions} />
    </View>
  )
}
