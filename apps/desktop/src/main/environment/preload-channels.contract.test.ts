/**
 * Contract: environment IPC channel strings used by Main handlers match
 * AgentIpcChannels and preload environmentAPI invoke targets.
 */
import { describe, expect, it } from 'vitest'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// apps/desktop/src/main/environment → apps/desktop
const ROOT = join(import.meta.dirname, '../../..')

describe('environment preload ↔ Main IPC contract', () => {
  it('defines stable environment channel constants', () => {
    expect(AgentIpcChannels.ENVIRONMENT_LIST).toBe('environment:list')
    expect(AgentIpcChannels.ENVIRONMENT_GET_LOCAL_ID).toBe('environment:getLocalId')
    expect(AgentIpcChannels.ENVIRONMENT_WORKSPACE_LIST_DIR).toBe('environment:workspaceListDir')
    expect(AgentIpcChannels.ENVIRONMENT_WORKSPACE_READ_FILE).toBe('environment:workspaceReadFile')
    expect(AgentIpcChannels.ENVIRONMENT_PAIR_REMOTE).toBe('environment:pairRemote')
    expect(AgentIpcChannels.ENVIRONMENT_CONNECT_FAILOVER).toBe('environment:connectWithFailover')
    expect(AgentIpcChannels.ENVIRONMENT_LOCAL_LAB_STATUS).toBe('environment:localLabStatus')
    expect(AgentIpcChannels.ENVIRONMENT_PAIR_LOCAL_LAB).toBe('environment:pairLocalLab')
  })

  it('defines the environment management channels used by the Settings page', () => {
    expect(AgentIpcChannels.ENVIRONMENT_LIST_ITEMS).toBe('environment:listItems')
    expect(AgentIpcChannels.ENVIRONMENT_ADD_OVER_SSH).toBe('environment:addOverSsh')
    expect(AgentIpcChannels.ENVIRONMENT_LIST_SSH_CONFIG_HOSTS).toBe(
      'environment:listSshConfigHosts',
    )
    expect(AgentIpcChannels.ENVIRONMENT_LIST_PROJECTS).toBe('environment:listProjects')
    expect(AgentIpcChannels.ENVIRONMENT_OPEN_PROJECT).toBe('environment:openProject')
    expect(AgentIpcChannels.ENVIRONMENT_REMOVE_PROJECT).toBe('environment:removeProject')
    expect(AgentIpcChannels.ENVIRONMENT_LIST_SESSIONS).toBe('environment:listSessions')
    expect(AgentIpcChannels.ENVIRONMENT_CREATE_SESSION).toBe('environment:createSession')
    expect(AgentIpcChannels.ENVIRONMENT_GET_SESSION).toBe('environment:getSession')
    expect(AgentIpcChannels.ENVIRONMENT_SEND_SESSION_MESSAGE).toBe('environment:sendSessionMessage')
    expect(AgentIpcChannels.ENVIRONMENT_LIST_SESSION_EVENTS).toBe('environment:listSessionEvents')
    expect(AgentIpcChannels.ENVIRONMENT_INTERRUPT_SESSION).toBe('environment:interruptSession')
    expect(AgentIpcChannels.ENVIRONMENT_RENAME_SESSION).toBe('environment:renameSession')
    expect(AgentIpcChannels.ENVIRONMENT_REMOVE_SESSION).toBe('environment:removeSession')
    expect(AgentIpcChannels.ENVIRONMENT_SET_SESSION_UI_FLAGS).toBe('environment:setSessionUiFlags')
    expect(AgentIpcChannels.ENVIRONMENT_FORK_SESSION).toBe('environment:forkSession')
    expect(AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_PERMISSION).toBe(
      'environment:respondSessionPermission',
    )
    expect(AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_QUESTION).toBe(
      'environment:respondSessionQuestion',
    )
    expect(AgentIpcChannels.ENVIRONMENT_RESPOND_SESSION_PLAN).toBe(
      'environment:respondSessionPlan',
    )
    expect(AgentIpcChannels.ENVIRONMENT_RESUME_REMOTE_SESSION_EVENTS).toBe(
      'environment:resumeRemoteSessionEvents',
    )
    expect(AgentIpcChannels.ENVIRONMENT_BROWSE_PATH).toBe('environment:browsePath')
    expect(AgentIpcChannels.ENVIRONMENT_CLONE_REPOSITORY).toBe('environment:cloneRepository')
    expect(AgentIpcChannels.ENVIRONMENT_CONNECT).toBe('environment:connect')
    expect(AgentIpcChannels.ENVIRONMENT_DISCONNECT).toBe('environment:disconnect')
    expect(AgentIpcChannels.ENVIRONMENT_FORGET).toBe('environment:forget')
    expect(AgentIpcChannels.ENVIRONMENT_STATUS_EVENT).toBe('environment:statusEvent')
    expect(AgentIpcChannels.ENVIRONMENT_INSTALL_PROGRESS).toBe('environment:installProgress')
    expect(AgentIpcChannels.ENVIRONMENT_HARNESS_LIST).toBe('environment:harnessList')
    expect(AgentIpcChannels.ENVIRONMENT_HARNESS_ENABLE).toBe('environment:harnessEnable')
    expect(AgentIpcChannels.ENVIRONMENT_HARNESS_DISABLE).toBe('environment:harnessDisable')
    expect(AgentIpcChannels.ENVIRONMENT_HARNESS_PROBE).toBe('environment:harnessProbe')
  })

  it('wires every management channel through Main and preload', () => {
    const main = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')
    const preload = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf8')
    const managed = [
      'ENVIRONMENT_LIST_ITEMS',
      'ENVIRONMENT_ADD_OVER_SSH',
      'ENVIRONMENT_LIST_SSH_CONFIG_HOSTS',
      'ENVIRONMENT_LIST_PROJECTS',
      'ENVIRONMENT_OPEN_PROJECT',
      'ENVIRONMENT_REMOVE_PROJECT',
      'ENVIRONMENT_LIST_SESSIONS',
      'ENVIRONMENT_CREATE_SESSION',
      'ENVIRONMENT_GET_SESSION',
      'ENVIRONMENT_SEND_SESSION_MESSAGE',
      'ENVIRONMENT_LIST_SESSION_EVENTS',
      'ENVIRONMENT_INTERRUPT_SESSION',
      'ENVIRONMENT_RENAME_SESSION',
      'ENVIRONMENT_REMOVE_SESSION',
      'ENVIRONMENT_SET_SESSION_UI_FLAGS',
      'ENVIRONMENT_FORK_SESSION',
      'ENVIRONMENT_RESPOND_SESSION_PERMISSION',
      'ENVIRONMENT_RESPOND_SESSION_QUESTION',
      'ENVIRONMENT_RESPOND_SESSION_PLAN',
      'ENVIRONMENT_RESUME_REMOTE_SESSION_EVENTS',
      'ENVIRONMENT_BROWSE_PATH',
      'ENVIRONMENT_CLONE_REPOSITORY',
      'ENVIRONMENT_CONNECT',
      'ENVIRONMENT_DISCONNECT',
      'ENVIRONMENT_FORGET',
      'ENVIRONMENT_STATUS_EVENT',
      'ENVIRONMENT_INSTALL_PROGRESS',
      'ENVIRONMENT_HARNESS_LIST',
      'ENVIRONMENT_HARNESS_ENABLE',
      'ENVIRONMENT_HARNESS_DISABLE',
      'ENVIRONMENT_HARNESS_PROBE',
      'ENVIRONMENT_LOCAL_LAB_STATUS',
      'ENVIRONMENT_PAIR_LOCAL_LAB',
    ]
    for (const channel of managed) {
      expect(preload, `preload missing ${channel}`).toContain(`AgentIpcChannels.${channel}`)
      expect(main, `main missing ${channel}`).toContain(`AgentIpcChannels.${channel}`)
    }
  })

  it('Main registerIpcHandlers wires AgentIpcChannels.ENVIRONMENT_*', () => {
    const main = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf8')
    expect(main).toContain('AgentIpcChannels.ENVIRONMENT_LIST')
    expect(main).toContain('AgentIpcChannels.ENVIRONMENT_PAIR_REMOTE')
    expect(main).toContain('getEnvironmentHost()')
  })

  it('preload exposes environmentAPI with matching channel constants', () => {
    const preload = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf8')
    expect(preload).toContain('environmentAPI')
    expect(preload).toContain("exposeInMainWorld('environment'")
    expect(preload).toContain('AgentIpcChannels.ENVIRONMENT_LIST')
    expect(preload).toContain('AgentIpcChannels.ENVIRONMENT_WORKSPACE_LIST_DIR')
    expect(preload).toContain('AgentIpcChannels.ENVIRONMENT_CONNECT_FAILOVER')
  })
})
