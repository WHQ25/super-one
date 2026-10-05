/** @vitest-environment jsdom */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { composerForSession, registerComposer, renderComposer, type OpenedComposerProps } from './composer-registry'
import { cancelComposer, clearSessionComposers, composerStackFor, submitComposer, topComposer, updateComposerValue } from './composer-stack'

const owner = { projectPath: '/composer-stack-test', sessionId: 'first' }
const sibling = { ...owner, sessionId: 'second' }
const otherProject = { projectPath: '/composer-stack-other', sessionId: 'first' }
const initialChat = useChatStore.getState()
const initialCatalog = useAppStore.getState().harnessCatalog
let unregister: () => void

function NoteComposer({ value, onValueChange, submit, cancel, active }: OpenedComposerProps) {
  return <>
    <input aria-label="Note" value={String(value.text ?? '')} onChange={event => onValueChange({ text: event.target.value })} />
    <button disabled={!active} onClick={() => submit(value)}>Submit note</button>
    <button disabled={!active} onClick={cancel}>Cancel note</button>
  </>
}

beforeEach(() => {
  const project = createDefaultProjectState()
  useChatStore.setState({ activeProject: owner.projectPath, projectSessions: {
    ...initialChat.projectSessions,
    [owner.projectPath]: { ...project, _activeSessionId: owner.sessionId, _sessions: {
      [owner.sessionId]: createDefaultPerSessionState(), [sibling.sessionId]: createDefaultPerSessionState(),
    } },
    [otherProject.projectPath]: { ...createDefaultProjectState(), _activeSessionId: otherProject.sessionId, _sessions: { [otherProject.sessionId]: createDefaultPerSessionState() } },
  } })
  useAppStore.setState({ harnessCatalog: null })
  unregister = registerComposer('test.note', NoteComposer)
})

afterEach(() => {
  for (const target of [owner, sibling, otherProject]) clearSessionComposers(target)
  unregister()
  useChatStore.setState(initialChat)
  useAppStore.setState({ harnessCatalog: initialCatalog })
})

describe('session composer stack', () => {
  it('returns temporary submissions and restores a persistent mode with its edited draft', async () => {
    const composer = composerForSession(owner)
    const persistent = composer.open('test.note', { lifetime: 'sticky', prefill: { text: 'initial' } })
    const base = topComposer(owner)!
    updateComposerValue(base, { text: 'edited base' })
    const temporary = composer.open('test.note', { prefill: { text: 'temporary' } })
    const overlay = topComposer(owner)!
    submitComposer(overlay, { text: 'answer' })
    expect(await temporary).toEqual({ text: 'answer' })
    expect(topComposer(owner)).toMatchObject({ key: base.key, value: { text: 'edited base' } })
    submitComposer(base, { text: 'persistent answer' })
    expect(await persistent).toEqual({ text: 'persistent answer' })
    expect(topComposer(owner)?.key).toBe(base.key)
    composer.returnToChat()
    expect(topComposer(owner)).toBeNull()
  })

  it('replaces only the persistent base while nested temporary requests stay stacked', async () => {
    const composer = composerForSession(owner)
    const oldBase = composer.open('test.note', { lifetime: 'sticky' })
    const first = composer.open('test.note', { prefill: { text: 'first' } })
    const firstEntry = topComposer(owner)!
    const second = composer.open('test.note', { prefill: { text: 'second' } })
    const secondEntry = topComposer(owner)!
    const newBase = composer.open('test.note', { lifetime: 'sticky', prefill: { text: 'new base' } })
    expect(await oldBase).toBeNull()
    expect(topComposer(owner)?.key).toBe(secondEntry.key)
    cancelComposer(secondEntry)
    expect(await second).toBeNull()
    expect(topComposer(owner)?.key).toBe(firstEntry.key)
    submitComposer(firstEntry, { done: true })
    expect(await first).toEqual({ done: true })
    expect(topComposer(owner)?.value).toEqual({ text: 'new base' })
    composer.returnToChat()
    expect(await newBase).toBeNull()
  })

  it('captures the owner and isolates identical session ids in different projects', async () => {
    const target = { ...owner }
    const composer = composerForSession(target)
    target.sessionId = sibling.sessionId
    const first = composer.open('test.note')
    const second = composerForSession(sibling).open('test.note')
    const third = composerForSession(otherProject).open('test.note')
    useChatStore.setState({ activeProject: otherProject.projectPath })
    composer.returnToChat()
    expect(await first).toBeNull()
    expect(topComposer(sibling)).not.toBeNull()
    expect(topComposer(otherProject)).not.toBeNull()
    clearSessionComposers(sibling)
    clearSessionComposers(otherProject)
    expect(await second).toBeNull()
    expect(await third).toBeNull()
  })

  it('cancels a covered request on abort without popping its newer sibling', async () => {
    const controller = new AbortController()
    const composer = composerForSession(owner)
    const first = composer.open('test.note', { signal: controller.signal })
    const obsolete = topComposer(owner)!
    const second = composer.open('test.note')
    const top = topComposer(owner)!
    controller.abort()
    expect(await first).toBeNull()
    expect(topComposer(owner)?.key).toBe(top.key)
    submitComposer(obsolete, { stale: true })
    updateComposerValue(obsolete, { stale: true })
    expect(topComposer(owner)?.key).toBe(top.key)
    cancelComposer(top)
    expect(await second).toBeNull()
  })

  it('keeps abort attached to a persistent mode after its first submission', async () => {
    const controller = new AbortController()
    const result = composerForSession(owner).open('test.note', { lifetime: 'sticky', signal: controller.signal })
    submitComposer(topComposer(owner)!, { accepted: true })
    expect(await result).toEqual({ accepted: true })
    controller.abort()
    expect(topComposer(owner)).toBeNull()
  })

  it('settles all requests when their session is removed without disturbing another session', async () => {
    const base = composerForSession(owner).open('test.note', { lifetime: 'sticky' })
    const overlay = composerForSession(owner).open('test.note')
    const other = composerForSession(sibling).open('test.note')
    useChatStore.getState().removeSessionFromMemory(owner.projectPath, owner.sessionId)
    expect(await base).toBeNull()
    expect(await overlay).toBeNull()
    expect(composerStackFor(owner).stack).toHaveLength(0)
    expect(topComposer(sibling)).not.toBeNull()
    clearSessionComposers(sibling)
    expect(await other).toBeNull()
  })

  it('rejects missing owners and unregistered composers without changing the stack', async () => {
    await expect(composerForSession(owner).open('missing')).rejects.toThrow('not registered')
    await expect(composerForSession({ ...owner, sessionId: 'missing' }).open('test.note')).rejects.toThrow('missing session')
    const controller = new AbortController()
    controller.abort()
    expect(await composerForSession(owner).open('test.note', { signal: controller.signal })).toBeNull()
    expect(topComposer(owner)).toBeNull()
    expect(() => registerComposer('decision', NoteComposer)).toThrow('unavailable')
  })

  it('cancels registrations on disposal and ignores repeated disposal after re-registration', async () => {
    const request = composerForSession(owner).open('test.note')
    const dispose = unregister
    dispose()
    expect(await request).toBeNull()
    unregister = registerComposer('test.note', NoteComposer)
    dispose()
    const next = composerForSession(owner).open('test.note')
    composerForSession(owner).returnToChat()
    expect(await next).toBeNull()
  })

  it('keeps an outgoing form inert while a decision preempts it and restores its draft afterward', async () => {
    let result!: ReturnType<ReturnType<typeof composerForSession>['open']>
    act(() => { result = composerForSession(owner).open('test.note') })
    const entry = topComposer(owner)!
    const view = () => renderComposer(entry.id, owner.sessionId, {
      showTodoPopup: false, autoFocusOnMount: false, onBaseComposerMounted: () => {}, microphoneShortcutEnabled: false,
      openedComposer: entry,
    })
    const { rerender } = render(view())
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'unsent form draft' } })
    act(() => useChatStore.setState(state => {
      const project = state.projectSessions[owner.projectPath]!
      return { projectSessions: { ...state.projectSessions, [owner.projectPath]: {
        ...project, _sessions: { ...project._sessions, [owner.sessionId]: {
          ...project._sessions[owner.sessionId]!, pendingPermissions: [{ requestId: 'approval', toolName: 'Read', input: {}, allowAlwaysAllow: false }],
        } },
      } } }
    }))
    expect(screen.getByRole('button', { name: 'Submit note' })).toBeDisabled()
    expect(document.querySelector('[data-opened-composer]')).toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'Submit note' }))
    expect(topComposer(owner)?.key).toBe(entry.key)
    act(() => useChatStore.setState(state => {
      const project = state.projectSessions[owner.projectPath]!
      return { projectSessions: { ...state.projectSessions, [owner.projectPath]: {
        ...project, _sessions: { ...project._sessions, [owner.sessionId]: { ...project._sessions[owner.sessionId]!, pendingPermissions: [] } },
      } } }
    }))
    rerender(view())
    expect(screen.getByLabelText('Note')).toHaveValue('unsent form draft')
    fireEvent.click(screen.getByRole('button', { name: 'Submit note' }))
    expect(await result).toEqual({ text: 'unsent form draft' })
  })
})
