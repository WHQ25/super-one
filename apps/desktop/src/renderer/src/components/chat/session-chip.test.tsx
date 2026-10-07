/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SessionChip, SessionLinkContext } from '@superone/chat-view/presenters/SessionChip'
import { createSessionLinkCache } from '@superone/chat-view/presenters/session-link-cache'
import { Streamdown } from 'streamdown'
import { createMarkdownRehypePlugins } from '@superone/chat-view/presenters/markdown-media'
import type { SessionLinkMetadataResult } from '@superone/shared/session-link'

vi.mock('@superone/ui/components/harness/resolve-session-icon', () => ({ resolveSessionIcon: (harness: string, agent: string) => () => <span data-testid="brand">{harness}:{agent}</span> }))
vi.stubGlobal('IntersectionObserver', undefined)
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges() })
function ports(lookup = async (refs: Array<{ environmentId: string; sessionId: string }>): Promise<SessionLinkMetadataResult[]> => refs.map(ref => ({ status: 'ok', metadata: { ref, harness: 'acp', acpAgentId: 'grok-build' } }))) {
  return { cache: createSessionLinkCache(lookup), open: vi.fn(async () => {}), onError: vi.fn() }
}
describe('SessionChip', () => {
  it('binds localhost to its message owner, loads branding, and copies an explicit reference', async () => {
    const p = ports()
    render(<SessionLinkContext.Provider value={{ sourceEnvironmentId: 'OwnerCase', ports: p }}><SessionChip href="session://localhost/SameID" label="原始标题" /></SessionLinkContext.Provider>)
    const chip = screen.getByRole('link', { name: '原始标题' })
    expect(chip.querySelector('.lucide-message-square')).not.toBeNull()
    await screen.findByTestId('brand')
    expect(chip.textContent).toContain('acp:grok-build')
    expect(chip.getAttribute('data-copy-text')).toBe('[原始标题](session://OwnerCase/SameID)')
    expect(chip.hasAttribute('data-selection-atomic')).toBe(true)
    expect(chip.getAttribute('href')).toBe('session://OwnerCase/SameID')
    fireEvent.click(chip)
    await waitFor(() => expect(p.open).toHaveBeenCalledWith({ environmentId: 'OwnerCase', sessionId: 'SameID' }))
  })
  it('retains the placeholder on metadata failure and reports only the click failure', async () => {
    const p = ports(async () => { throw new Error('offline') }); p.open.mockRejectedValue(new Error('offline'))
    render(<SessionLinkContext.Provider value={{ ports: p }}><SessionChip href="session://remote/id" label="Title" /></SessionLinkContext.Provider>)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(p.onError).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link'))
    await waitFor(() => expect(p.onError).toHaveBeenCalledOnce())
    expect(screen.getByRole('link').querySelector('.lucide-message-square')).not.toBeNull()
  })
  it('does not navigate while selecting text and blocks repeated activation', async () => {
    let finish!: () => void
    const p = ports(); p.open.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    render(<SessionLinkContext.Provider value={{ ports: p }}><SessionChip href="session://remote/id" label="Title" /></SessionLinkContext.Provider>)
    const chip = screen.getByRole('link'), range = document.createRange()
    range.selectNodeContents(chip); window.getSelection()?.addRange(range)
    fireEvent.click(chip, { detail: 1 }); expect(p.open).not.toHaveBeenCalled()
    window.getSelection()?.removeAllRanges()
    fireEvent.click(chip); fireEvent.click(chip)
    expect(p.open).toHaveBeenCalledOnce()
    await act(async () => finish())
  })
  it('allows keyboard activation while text elsewhere remains selected', async () => {
    const p = ports()
    render(<SessionLinkContext.Provider value={{ ports: p }}><p>Selected text</p><SessionChip href="session://remote/id" label="Title" /></SessionLinkContext.Provider>)
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('Selected text')); window.getSelection()?.addRange(range)
    fireEvent.click(screen.getByRole('link'), { detail: 0 })
    await waitFor(() => expect(p.open).toHaveBeenCalledOnce())
  })
  it('leaves malformed links as text and missing source disabled', () => {
    const p = ports()
    render(<SessionLinkContext.Provider value={{ ports: p }}><SessionChip href="session://host/id?x=1" label="Invalid" /><SessionChip href="session://localhost/id" label="Relative" /></SessionLinkContext.Provider>)
    expect(screen.getByText('Invalid').tagName).toBe('SPAN')
    fireEvent.click(screen.getByRole('link', { name: 'Relative' }))
    expect(p.open).not.toHaveBeenCalled()
    expect(p.onError).toHaveBeenCalledOnce()
  })
  it('preserves session destinations through sanitization while stripping unsafe schemes and incomplete streams', () => {
    const props = { rehypePlugins: createMarkdownRehypePlugins({ srcProtocols: [] }), components: { a: ({ href, children }: { href?: string; children?: React.ReactNode }) => href?.startsWith('session:') ? <SessionChip href={href} label={String(children)} /> : <a href={href}>{children}</a> } }
    const { container, rerender } = render(<Streamdown {...props}>[Title](session://HostCase/SessionCase) [bad](javascript:alert%281%29)</Streamdown>)
    expect(screen.getByRole('link', { name: 'Title' }).getAttribute('href')).toBe('session://HostCase/SessionCase')
    expect(container.innerHTML).not.toContain('javascript:')
    rerender(<Streamdown {...props} mode="streaming" isAnimating>[Title](session://HostCase/partial</Streamdown>)
    expect(container.querySelector('a[href^="session:"]')).toBeNull()
  })
})
