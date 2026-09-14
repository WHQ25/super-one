import { useState } from 'react'
import { View } from 'react-native'
import { TransportLedger } from '@superone/relay-client/transport-ledger'
import { NetworkLedgerPanel } from './network-ledger-panel'

export default { title: 'Mobile/NetworkLedger', component: NetworkLedgerPanel }
function Example({ traffic = false, narrow = false }) {
  const [ledger] = useState(() => {
    const ledger = new TransportLedger()
    ledger.mark('open-session')
    if (traffic) {
      ledger.record({ kind: 'rpc', name: 'subscribe_session', count: 1, durationMs: 42, transport: 'relay' })
      ledger.record({ kind: 'wire-in', name: 'response', bytes: 2048, transport: 'relay' })
      ledger.record({ kind: 'decoded', name: 'response', bytes: 18200, durationMs: 3, transport: 'relay' })
      ledger.record({ kind: 'wire-in', name: 'event', count: 40, bytes: 64000, transport: 'relay' })
    }
    return ledger
  })
  return <View style={{ width: narrow ? 280 : 400, padding: 16 }}><NetworkLedgerPanel ledger={ledger} /></View>
}
export const Empty = () => <Example />
export const TrafficAndReset = () => <Example traffic />
export const Narrow = () => <Example traffic narrow />
