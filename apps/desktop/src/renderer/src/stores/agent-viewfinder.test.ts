import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectViewfinderOwner,
  useAgentViewfinderStore,
  type ViewfinderKind,
} from './agent-viewfinder'

const report = (kind: ViewfinderKind, present: boolean, pinned = false) =>
  useAgentViewfinderStore.getState().report(kind, { present, pinned })

const owner = () => selectViewfinderOwner(useAgentViewfinderStore.getState())

beforeEach(() => {
  const idle = { present: false, pinned: false, seq: 0 }
  useAgentViewfinderStore.setState({ claims: { device: idle, browser: idle, computer: idle } })
})

describe('the shared agent viewfinder', () => {
  it('shows nothing until something asks for it', () => {
    expect(owner()).toBeNull()
  })

  /**
   * The whole reason this store exists. Three subsystems could each put a floating
   * preview on screen, and two at once are not two useful views: separately draggable
   * boxes over the same chat, at different z-layers, neither of them saying which one
   * the agent is actually driving.
   */
  it('gives the slot to the target touched most recently', () => {
    report('device', true)
    report('browser', true)

    expect(owner()).toBe('browser')

    report('computer', true)
    expect(owner()).toBe('computer')
  })

  it('lets a pinned target outrank a newer one, because a pin is a request', () => {
    report('device', true, true)
    report('computer', true)

    // The agent moving on to the desktop must not yank away a preview the user
    // deliberately put on screen. Recency is only the default for "no preference".
    expect(owner()).toBe('device')
  })

  it('hands the slot on the moment the pin is dropped', () => {
    report('device', true, true)
    report('computer', true)
    report('device', true, false)

    expect(owner()).toBe('computer')
  })

  it('falls back to whatever is left when the winner goes away', () => {
    report('device', true)
    report('computer', true)
    expect(owner()).toBe('computer')

    // A turn ending is the common case: Computer Use releases and the device the
    // session still holds should come back rather than the chat going blank.
    report('computer', false)
    expect(owner()).toBe('device')
  })

  it('does not re-order the winner when a report says nothing new', () => {
    report('device', true)
    report('browser', true)
    expect(owner()).toBe('browser')

    // Every reporter fires on every render. An unchanged report that reshuffled the
    // order would make the winner depend on which component happened to re-render.
    report('device', true)
    expect(owner()).toBe('browser')
  })

  it('ranks two pinned targets by which was pinned last', () => {
    report('device', true, true)
    report('browser', true, true)

    expect(owner()).toBe('browser')
  })
})
