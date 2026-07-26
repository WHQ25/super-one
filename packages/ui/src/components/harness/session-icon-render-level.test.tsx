/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClaudeSessionIcon } from './ClaudeSessionIcon'
import { CodexSessionIcon } from './CodexSessionIcon'

/**
 * A sidebar renders one icon per session, so every interpolating animation here
 * is multiplied by the session count and pins the compositor at full frame rate.
 * The contract: `compact` keeps only sparse-keyframe animations (blink, step-end
 * cursor) on resting statuses; `rich` (chat suggestions, single icon) keeps all.
 * Active statuses (running/background/unseen) animate at every level — their
 * motion carries state, not decoration.
 */

function classesOf(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('*'))
    .map((el) => el.getAttribute('class') ?? '')
    .join(' ')
}

describe('session icon render levels', () => {
  it('drops the Claude float and leg wiggle on a resting compact icon but keeps the blink', () => {
    const { container } = render(<ClaudeSessionIcon status="default" renderLevel="compact" />)
    const classes = classesOf(container)

    expect(classes).not.toContain('claude-session-idle-motion')
    expect(classes).not.toContain('claude-session-idle-leg-left')
    expect(classes).not.toContain('claude-session-idle-leg-right')
    expect(classes).toContain('claude-session-inline')
    expect(classes).toContain('claude-session-idle-eyes')
  })

  it('keeps every Claude animation on a resting rich icon', () => {
    const { container } = render(<ClaudeSessionIcon status="default" renderLevel="rich" />)
    const classes = classesOf(container)

    expect(classes).toContain('claude-session-idle-motion')
    expect(classes).toContain('claude-session-idle-leg-left')
    expect(classes).toContain('claude-session-idle-eyes')
  })

  it('defaults to rich so an icon rendered without a render level keeps its motion', () => {
    const { container } = render(<ClaudeSessionIcon status="default" />)

    expect(classesOf(container)).toContain('claude-session-idle-motion')
  })

  it('still animates a running Claude icon at compact — that motion signals state', () => {
    const { container } = render(<ClaudeSessionIcon status="running" renderLevel="compact" />)

    expect(classesOf(container)).toContain('claude-session-jump')
  })

  it('drops the Codex scale and shimmer on a resting compact icon but keeps the cursor', () => {
    const { container } = render(<CodexSessionIcon status="default" renderLevel="compact" />)
    const classes = classesOf(container)

    expect(classes).not.toContain('codex-session-scale')
    expect(classes).not.toContain('codex-session-warm')
    expect(classes).not.toContain('codex-session-spec')
    expect(classes).toContain('codex-session-cursor')
  })

  it('keeps every Codex animation on a resting rich icon', () => {
    const { container } = render(<CodexSessionIcon status="default" renderLevel="rich" />)
    const classes = classesOf(container)

    expect(classes).toContain('codex-session-scale')
    expect(classes).toContain('codex-session-warm')
    expect(classes).toContain('codex-session-cursor')
  })

  it('drops the Codex automation shimmer at compact', () => {
    const { container } = render(<CodexSessionIcon status="automation" renderLevel="compact" />)
    const classes = classesOf(container)

    expect(classes).not.toContain('codex-session-scale')
    expect(classes).not.toContain('codex-session-warm')
  })
})
