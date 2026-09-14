import { TransportLedger } from '@superone/relay-client/transport-ledger'

/** Development diagnostics only. No payloads or persistent identifiers are retained. */
export const networkLedger = new TransportLedger()
export const networkMetricsEnabled = typeof __DEV__ !== 'undefined' && __DEV__
