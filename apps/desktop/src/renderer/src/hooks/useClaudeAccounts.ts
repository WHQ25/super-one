import { useEffect } from 'react'
import { create } from 'zustand'
import type { ClaudeAccount } from '@superone/shared/agent-types'

const useAccounts = create<{ accounts: ClaudeAccount[] }>(() => ({ accounts: [] }))
let pending: Promise<void> | null = null
let refreshAgain = false
export function refreshClaudeAccounts(force = false): Promise<void> {
  if (pending) { refreshAgain ||= force; return pending }
  pending = (async () => {
    let nextForce = force
    do {
      refreshAgain = false
      const accounts = await window.app.claudeListAccounts(nextForce)
      useAccounts.setState({ accounts: accounts ?? [] })
      nextForce = refreshAgain
    } while (refreshAgain)
  })().finally(() => { pending = null })
  return pending
}
export function claudeAccountsChanged(): void {
  window.dispatchEvent(new Event('claude-accounts-changed'))
}
let observers = 0
const onAccountsChanged = (event: Event) => {
  const connectionId = event instanceof CustomEvent ? event.detail?.connectionId : undefined
  // A remote host's catalog change is not a local account list.
  if (typeof connectionId === 'string' && connectionId !== 'local') return
  void refreshClaudeAccounts(true).catch(() => {})
}
export function useClaudeAccounts(enabled = true): ClaudeAccount[] {
  const accounts = useAccounts((state) => state.accounts)
  useEffect(() => {
    if (!enabled) return
    void refreshClaudeAccounts().catch(() => {})
    if (observers++ === 0) window.addEventListener('claude-accounts-changed', onAccountsChanged)
    return () => { if (--observers === 0) window.removeEventListener('claude-accounts-changed', onAccountsChanged) }
  }, [enabled])
  return accounts
}
