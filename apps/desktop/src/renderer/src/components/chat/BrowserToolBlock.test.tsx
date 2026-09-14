/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrowserToolBlockPresenter } from '@superone/chat-view/presenters/BrowserToolBlock'
import { ComputerUseToolBlockPresenter } from '@superone/chat-view/presenters/ComputerUseToolBlock'
import { DeviceToolBlockPresenter } from '@superone/chat-view/presenters/DeviceToolBlock'

function expectRecordingIconWithChevron(container: HTMLElement) {
  const icon = screen.getByLabelText('Action recording')
  const chevron = container.querySelector('.lucide-chevron-right')
  expect(chevron).toBeTruthy()
  expect(icon.parentElement?.parentElement).toBe(chevron?.parentElement)
  expect(chevron?.parentElement).toHaveClass('ml-auto')
}

describe('interactive tool recording icon', () => {
  it('parks the browser recording icon with the expand chevron', () => {
    const { container } = render(
      <BrowserToolBlockPresenter
        op="click"
        params={{ description: 'Verify the reply reappears after a missed update' }}
        result={JSON.stringify({ ok: true })}
        isStreaming={false}
        recording={<video aria-label="clip" />}
      />,
    )
    expectRecordingIconWithChevron(container)
  })

  it('parks the computer-use recording icon with the expand chevron', () => {
    const { container } = render(
      <ComputerUseToolBlockPresenter
        op="act"
        params={{ description: 'Click the Save button' }}
        result={JSON.stringify({ outcome: 'worked' })}
        isStreaming={false}
        recording={<video aria-label="clip" />}
      />,
    )
    expectRecordingIconWithChevron(container)
  })

  it('parks the device recording icon with the expand chevron', () => {
    const { container } = render(
      <DeviceToolBlockPresenter
        op="act"
        params={{ description: 'Tap Settings after the spinner clears' }}
        result={JSON.stringify({ outcome: 'worked', settled: true })}
        isStreaming={false}
        recording={<video aria-label="clip" />}
      />,
    )
    expectRecordingIconWithChevron(container)
  })
})
