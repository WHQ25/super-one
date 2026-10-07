/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CopyableMarkdown } from './CopyableMarkdown'

vi.mock('@/lib/session-links', () => ({ DesktopSessionLinkScope: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./chat-shared', async () => {
  const { createMarkdownRehypePlugins } = await import('@superone/chat-view/presenters/markdown-media')
  return {
    streamdownPlugins: {}, streamdownControls: {}, streamdownComponents: {},
    streamdownRehypePlugins: createMarkdownRehypePlugins({ srcProtocols: [] }),
    getMathPluginSync: () => null, loadMathPlugin: async () => null,
    streamdownLinkSafety: { enabled: true, renderModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm(): void }) => isOpen ? <span role="dialog"><button onClick={onConfirm}>Confirm external</button></span> : null },
  }
})
vi.mock('./CodeBlock', () => ({ createStreamdownCodeComponent: () => 'code' }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('desktop Markdown links', () => {
  it('keeps Link Safety for ordinary links alongside SessionChip', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<CopyableMarkdown text="[External](https://example.com) [Session](session://host/id)" isStreaming={false} />)
    expect(screen.getByRole('link', { name: 'Session' }).getAttribute('href')).toBe('session://host/id')
    fireEvent.click(screen.getByRole('button', { name: 'External' }))
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm external' }))
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noreferrer')
  })
  it('keeps incomplete streaming destinations inactive', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<CopyableMarkdown text="[External](https://example" isStreaming />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button', { name: 'External' })).toBeNull()
    fireEvent.click(screen.getByText('External'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(open).not.toHaveBeenCalled()
  })
})
