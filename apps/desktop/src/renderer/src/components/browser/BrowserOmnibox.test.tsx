/** @vitest-environment jsdom */

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { BrowserOmnibox } from './BrowserOmnibox'
import { useBrowserStore } from '@/stores/browser'

const marker = (c: HTMLElement) => c.querySelector('.lucide-triangle-alert')

afterEach(() => {
  cleanup()
  act(() => useBrowserStore.setState({ insecureHosts: {} }))
})

describe('BrowserOmnibox insecure marker', () => {
  it('shows the "not secure" badge for an https host the user bypassed', () => {
    act(() => useBrowserStore.getState().markInsecure('bad.example', 'ERR_CERT_DATE_INVALID'))
    const { container } = render(
      <BrowserOmnibox browserId="browser-1" url="https://bad.example/page" isHome={false} onNavigate={() => {}} />,
    )
    expect(marker(container)).not.toBeNull()
  })

  it('does not show the badge for a secure host that was never bypassed', () => {
    act(() => useBrowserStore.getState().markInsecure('bad.example', 'ERR_CERT_DATE_INVALID'))
    const { container } = render(
      <BrowserOmnibox browserId="browser-1" url="https://good.example/" isHome={false} onNavigate={() => {}} />,
    )
    expect(marker(container)).toBeNull()
  })

  it('does not show the badge for a bypassed host once served over plain http', () => {
    act(() => useBrowserStore.getState().markInsecure('bad.example', 'ERR_CERT_DATE_INVALID'))
    const { container } = render(
      <BrowserOmnibox browserId="browser-1" url="http://bad.example/" isHome={false} onNavigate={() => {}} />,
    )
    expect(marker(container)).toBeNull()
  })

  it('does not show the badge on the home/new-tab state', () => {
    act(() => useBrowserStore.getState().markInsecure('bad.example', 'ERR_CERT_DATE_INVALID'))
    const { container } = render(
      <BrowserOmnibox browserId="browser-1" url="https://bad.example/" isHome onNavigate={() => {}} />,
    )
    expect(marker(container)).toBeNull()
  })
})
