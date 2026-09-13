import { ipcMain, shell } from 'electron'
import { AgentIpcChannels, type CodexAccountLoginStartResult } from '@superone/shared/agent-types'
import { CodexAccountIpcChannels } from '@superone/shared/codex-accounts'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import log from '../logger'
import type { CodexExperimentService } from './codex-experiment-service'

export function registerCodexAccountIpc(codexService: CodexExperimentService): void {
  ipcMain.handle(AgentIpcChannels.CODEX_GET_ACCOUNT_STATUS, async (_event, projectPath: string, apiProviderId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexGetAccountStatus } = await import('../environment')
      const status = await remoteCodexGetAccountStatus(getEnvironmentHost(), projectPath, apiProviderId)
      if (status) return status
      throw new Error('Remote Codex account status unavailable (node not connected or project unresolved)')
    }
    return codexService.getAccountStatus(apiProviderId)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_ACCOUNT_LOGIN_START, async (_event, projectPath: string, accountId?: string) => {
    let result: CodexAccountLoginStartResult
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexAccountLoginStart } = await import('../environment')
      const remoteResult = await remoteCodexAccountLoginStart(getEnvironmentHost(), projectPath, accountId)
      if (!remoteResult) throw new Error('Remote Codex login unavailable (node not connected or project unresolved)')
      result = remoteResult as CodexAccountLoginStartResult
    } else {
      result = await codexService.startAccountLogin(projectPath, accountId)
    }
    const url = result.authUrl ?? result.verificationUrl
    if (url) {
      void shell.openExternal(url).catch((error) => {
        log.warn('[codex] failed to open account login URL: %s', error instanceof Error ? error.message : String(error))
      })
    }
    return result
  })

  ipcMain.handle(AgentIpcChannels.CODEX_ACCOUNT_LOGIN_CANCEL, async (_event, projectPath: string, loginId: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexAccountLoginCancel } = await import('../environment')
      await remoteCodexAccountLoginCancel(getEnvironmentHost(), projectPath, loginId)
      return
    }
    await codexService.cancelAccountLogin(loginId)
  })

  ipcMain.handle(AgentIpcChannels.CODEX_ACCOUNT_LOGOUT, async (_event, projectPath: string, apiProviderId?: string | null) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexAccountLogout } = await import('../environment')
      const status = await remoteCodexAccountLogout(getEnvironmentHost(), projectPath, apiProviderId)
      if (status) return status
      throw new Error('Remote Codex logout unavailable (node not connected or project unresolved)')
    }
    return codexService.logoutAccount(apiProviderId)
  })


  ipcMain.handle(CodexAccountIpcChannels.LIST, async (_event, projectPath: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexListAccounts } = await import('../environment')
      const result = await remoteCodexListAccounts(getEnvironmentHost(), projectPath)
      if (!result) throw new Error('Remote Codex accounts unavailable')
      return result
    }
    return codexService.accounts.list()
  })
  ipcMain.handle(CodexAccountIpcChannels.SET_DEFAULT, async (_event, projectPath: string, accountId: string) => {
    if (parseRemoteProjectKey(projectPath)) {
      const { getEnvironmentHost, remoteCodexSetDefaultAccount } = await import('../environment')
      const result = await remoteCodexSetDefaultAccount(getEnvironmentHost(), projectPath, accountId)
      if (!result) throw new Error('Remote Codex accounts unavailable')
      return
    }
    await codexService.accounts.setDefault(accountId)
  })
}
