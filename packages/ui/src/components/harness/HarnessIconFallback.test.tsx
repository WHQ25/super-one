/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AcpSessionIcon } from './AcpSessionIcon'
import { GrokSessionIcon } from './GrokSessionIcon'
import { HarnessIconFallback } from './HarnessIconFallback'
import { OpenCodeSessionIcon } from './OpenCodeSessionIcon'

function classesOf(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('*'))
    .map((el) => el.getAttribute('class') ?? '')
    .join(' ')
}

describe('HarnessIconFallback', () => {
  it('keeps the default mark static', () => {
    const { container } = render(
      <HarnessIconFallback status="default">
        <span data-testid="mark" />
      </HarnessIconFallback>,
    )
    const classes = classesOf(container)
    expect(classes).not.toContain('harness-session-pulse')
    expect(classes).not.toContain('harness-session-breathe')
    expect(container.querySelector('.harness-session-corner')).toBeNull()
  })

  it('pulses while running and breathes in background', () => {
    const running = render(
      <HarnessIconFallback status="running">
        <span />
      </HarnessIconFallback>,
    )
    expect(classesOf(running.container)).toContain('harness-session-pulse')

    const background = render(
      <HarnessIconFallback status="background">
        <span />
      </HarnessIconFallback>,
    )
    expect(classesOf(background.container)).toContain('harness-session-breathe')
  })

  it('shows a check badge for unseen and a clock for automation', () => {
    const unseen = render(
      <HarnessIconFallback status="unseen">
        <span />
      </HarnessIconFallback>,
    )
    expect(unseen.container.querySelector('.harness-session-corner-check')).not.toBeNull()
    expect(unseen.container.querySelector('.harness-session-corner-clock')).toBeNull()

    const automation = render(
      <HarnessIconFallback status="automation">
        <span />
      </HarnessIconFallback>,
    )
    expect(automation.container.querySelector('.harness-session-corner-clock')).not.toBeNull()
    expect(automation.container.querySelector('.harness-session-corner-check')).toBeNull()
  })
})

describe('static harness icons use fallback chrome', () => {
  it.each([
    ['Grok', GrokSessionIcon],
    ['OpenCode', OpenCodeSessionIcon],
    ['ACP', AcpSessionIcon],
  ] as const)('%s running uses the shared pulse', (_name, Icon) => {
    const { container } = render(<Icon status="running" />)
    expect(classesOf(container)).toContain('harness-session-pulse')
  })

  it.each([
    ['Grok', GrokSessionIcon],
    ['OpenCode', OpenCodeSessionIcon],
    ['ACP', AcpSessionIcon],
  ] as const)('%s unseen mounts the check badge', (_name, Icon) => {
    const { container } = render(<Icon status="unseen" />)
    expect(container.querySelector('.harness-session-corner-check')).not.toBeNull()
  })
})
