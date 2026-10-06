import { ipcMain } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { cancelSignIn, createAccountDir, listAccounts, setDefaultAccount, signInAccount, signOutAccount } from './claude-account-service'
export function registerClaudeAccountIpc(): void {
  ipcMain.handle(AgentIpcChannels.CLAUDE_LIST_ACCOUNTS, (_event, force?: boolean) => listAccounts(force ?? false))
  ipcMain.handle(AgentIpcChannels.CLAUDE_SIGN_IN_ACCOUNT, (_event, email?: string | null, dir?: string) => signInAccount(dir ?? createAccountDir(), email))
  ipcMain.handle(AgentIpcChannels.CLAUDE_SIGN_OUT_ACCOUNT, (_event, dir: string) => signOutAccount(dir))
  ipcMain.handle(AgentIpcChannels.CLAUDE_SET_DEFAULT_ACCOUNT, (_event, dir: string | null) => setDefaultAccount(dir))
  ipcMain.handle(AgentIpcChannels.CLAUDE_CANCEL_SIGN_IN, () => cancelSignIn())
}
