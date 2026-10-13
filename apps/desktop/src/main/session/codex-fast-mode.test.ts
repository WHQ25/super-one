/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ModelOption, SendMessageRequest } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat-store/index'
import { createDefaultPerSessionState, createDefaultProjectState } from '@/stores/chat-store/defaults'
import { getActiveSessionView } from '@/stores/chat-store/selectors'
import { ChatRuntime } from '../../../../mobile/src/runtime'
import { optionParamsForModel } from '../../../../mobile/src/model-picker-state'
import { openedSessionSelection } from '../../../../mobile/src/session-restore-selection'
import { desktopSendRequest } from '../node-host/desktop-session-mutations'
import { nativeRestoreClient, nativeSessionLoad } from './native-restore.test-fixtures'
import { Session } from './session'
import type { SessionBackend, SessionStateChange } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-path', () => ({ ensureShellPath: async () => {}, isShellPathReady: () => true }))

const projectPath = '/project'
const model: ModelOption = {
  id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', description: '',
  serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }],
}
const sessions: Session[] = []
const phones: ChatRuntime[] = []

beforeEach(() => {
  useChatStore.setState({
    activeProject: projectPath,
    projectSessions: {
      [projectPath]: {
        ...createDefaultProjectState(), _activeSessionId: 'session', codexModels: [model],
        _sessions: {
          session: {
            ...createDefaultPerSessionState(), sessionProvider: 'codex', preferredProvider: 'codex',
            hostSessionOwned: true, _historyHydrated: true,
          },
        },
      },
    },
  })
})

afterEach(async () => {
  for (const phone of phones.splice(0)) phone.dispose()
  for (const session of sessions.splice(0)) await session.dispose()
})

function createHost(serviceTier?: string | null, stored?: SessionStateChange) {
  const backend = {
    kind: 'codex', start: vi.fn(async () => {}),
    send: vi.fn(async (_request: SendMessageRequest) => {}),
    setCodexSelection: vi.fn(async () => {}),
    onEvent: () => () => {}, onProviderSessionId: () => () => {},
    onPermissionModeApplied: () => () => {}, close: vi.fn(async () => {}),
  }
  const onStateChange = vi.fn<(state: SessionStateChange) => void>()
  const session = new Session({
    id: 'session', projectPath, cwd: projectPath, providerId: 'codex-base', harnessId: 'codex',
    providerConfig: {}, model: stored?.selectedModel ?? model.id, effort: 'xhigh',
    codexServiceTier: serviceTier, initialMessages: stored?.messages,
    backend: backend as unknown as SessionBackend, onStateChange,
  })
  sessions.push(session)
  return { session, backend, onStateChange }
}

async function openPhone(session: Session) {
  const client = nativeRestoreClient(() => nativeSessionLoad(session), () => [session.getReplayEvents()])
  const phone = new ChatRuntime(client as never, () => {})
  phones.push(phone)
  await phone.open(projectPath, session.id)
  return { phone, client }
}

describe('Codex Fast on a session sent from a phone', () => {
  it.each([
    { scenario: 'enables Fast on the first send', initial: undefined, requested: 'priority', expected: 'priority' },
    { scenario: 'disables a previously saved Fast selection', initial: 'priority', requested: null, expected: null },
    { scenario: 'retains Fast when a send does not override it', initial: 'priority', requested: undefined, expected: 'priority' },
  ])('$scenario across live desktop state, persistence and mobile reopen', async ({ initial, requested, expected }) => {
    const { session, backend, onStateChange } = createHost(initial)
    const { phone, client } = await openPhone(session)
    const events: AgentEvent[] = []
    const unsubscribe = session.on((event) => {
      events.push(event)
      useChatStore.getState().handleAgentEvent(event)
      phone.ingest([event])
    })
    events.length = 0

    const selectionAtBackendSend = vi.fn(() => ({
      authority: session.getUiSettings().selectedCodexServiceTier,
      persisted: onStateChange.mock.calls.at(-1)?.[0].codexServiceTier,
      published: events.some((event) => event.type === 'agent_setting_change'
        && event.patch?.selectedCodexServiceTier === expected),
    }))
    backend.send.mockImplementation(async (_request: SendMessageRequest) => {
      selectionAtBackendSend()
    })

    let sending: Promise<void> | undefined
    client.controlledRpc = async (_resource, method, payload) => {
      if (method !== 'session.send') throw new Error(`Unexpected RPC ${method}`)
      const request = desktopSendRequest({
        ...payload, sessionId: session.id, text: String(payload.text),
        client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1',
      }, 'codex')
      sending = session.send(request, { providerOrigin: 'remote' }).then(() => {})
      await sending
      return { ok: true }
    }

    phone.send('Use the selected speed', {
      clientMessageId: 'phone-first-turn', model: model.id, effort: 'xhigh',
      ...(requested !== undefined ? { serviceTier: requested } : {}),
    })
    expect(sending).toBeDefined()
    await sending

    // Prove the phone's choice reached the backend before checking the state
    // that controls the Fast marks on both clients.
    expect(backend.send).toHaveBeenCalledOnce()
    // Commit the setting and publish its change before executing the turn;
    // delivery to subscribers may complete asynchronously afterward.
    expect.soft(selectionAtBackendSend.mock.results[0].value).toMatchObject({
      authority: expected, persisted: expected,
      ...(requested !== undefined ? { published: true } : {}),
    })
    if (requested !== undefined) {
      expect(backend.send.mock.calls[0][0].codex?.serviceTier).toBe(requested)
      expect.soft(events).toContainEqual(expect.objectContaining({
        type: 'agent_setting_change', patch: expect.objectContaining({ selectedCodexServiceTier: expected }),
      }))
      expect.soft(session.getUiSettings().selectedCodexServiceTier).toBe(expected)
    }
    expect.soft(getActiveSessionView(null).selectedCodexServiceTier).toBe(expected)

    const stored = onStateChange.mock.calls.at(-1)?.[0]
    expect(stored).toBeDefined()
    expect.soft(stored?.codexServiceTier).toBe(expected)
    unsubscribe()
    phone.dispose()

    // A cold host uses the persisted setting, rather than the running
    // backend's copy that already received the right tier for this turn.
    const cold = createHost(stored?.codexServiceTier, stored)
    const reopened = await openPhone(cold.session)
    const selection = openedSessionSelection('codex', reopened.phone.session)
    expect.soft(selection.serviceTier).toBe(expected)
    expect.soft(optionParamsForModel('codex', model, selection)[0].selected)
      .toBe(expected === 'priority' ? 'true' : 'false')
  })
})
