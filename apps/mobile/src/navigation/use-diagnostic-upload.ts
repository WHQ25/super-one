import { useEffect } from 'react'
import { AppState } from 'react-native'
import type { RelayClient } from '@superone/relay-client'
import { startDiagnosticUpload } from '../diagnostic-log'

/**
 * Ship the diagnostic buffer to the paired desktop while connected, and once
 * more as the app leaves the foreground — the last chance before it may be
 * suspended with lines still held.
 */
export function useDiagnosticUpload(client: RelayClient | null, connected: boolean): void {
  useEffect(() => {
    if (!client || !connected) return
    const upload = startDiagnosticUpload(client)
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'background') upload.flush() })
    return () => { subscription.remove(); upload.stop() }
  }, [client, connected])
}
