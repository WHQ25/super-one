/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BrowserToolBlockPresenter } from '@superone/chat-view/presenters/BrowserToolBlock'
import { getBrowserOp } from './browser-tool-display'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { ComputerUseToolBlockPresenter } from '@superone/chat-view/presenters/ComputerUseToolBlock'
import { DeviceToolBlockPresenter } from '@superone/chat-view/presenters/DeviceToolBlock'
import { getComputerOp } from './computer-tool-display'
import { getDeviceOp } from './device-tool-display'

describe('browser memory presentation across desktop and mobile', () => {
  it('keeps the domain and topic on mobile without forwarding the saved content', () => {
    const params = { domain: 'github.com', topic: 'search', content: 'Private content', expectedRevision: 'secret' }
    const input = JSON.parse(sanitizeRemoteToolInput('mcp__superone__browser_memory_write', JSON.stringify(params)))
    expect(input).toEqual({ domain: 'github.com', topic: 'search' })
    expect(getBrowserOp('browser_memory_write', input)).toBe('memory_write')
    render(<BrowserToolBlockPresenter op="memory_write" params={input} isStreaming={false} />)
    expect(screen.getByText('Memory Saved')).toBeTruthy()
    expect(screen.getByText('github.com/search')).toBeTruthy()
  })
  it('expands a read result and uses an action label for a revision conflict', () => {
    const props = { op: 'memory_read' as const, params: { domain: 'github.com', topic: 'search' }, isStreaming: false }
    const { rerender } = render(<BrowserToolBlockPresenter {...props} result={JSON.stringify({ content: 'Wait for results.' })} />)
    fireEvent.click(screen.getByText('Memory Read'))
    expect(screen.getByText('Wait for results.')).toBeTruthy()
    rerender(<BrowserToolBlockPresenter {...props} op="memory_write" result="[Error] Revision conflict" isError />)
    expect(screen.getByText('Save Memory')).toBeTruthy()
    expect(screen.queryByText('Memory Saved')).toBeNull()
  })
  it('routes archive and restore through their dedicated operation', () => {
    expect(getBrowserOp('browser_action', { action: 'archive' })).toBe('action_archive')
    render(<BrowserToolBlockPresenter op="action_archive" params={{ domain: 'github.com', name: 'search', archived: false }} isStreaming={false} />)
    expect(screen.getByText('Action Restored')).toBeTruthy()
  })

  it.each([
    { family: 'computer', platform: 'macos', Presenter: ComputerUseToolBlockPresenter, resolve: getComputerOp, icon: '.lucide-mouse-pointer-2' },
    { family: 'device', platform: 'android', Presenter: DeviceToolBlockPresenter, resolve: getDeviceOp, icon: '.lucide-smartphone' },
  ])('renders $family memory with its native icon and safe mobile identity', ({ family, platform, Presenter, resolve, icon }) => {
    const args = { platform, appId: 'com.example.app', topic: 'search', content: 'Private procedure', expectedRevision: 'private', status: 'deprecated' }
    const safe = JSON.parse(sanitizeRemoteToolInput(`mcp__superone__${family}_memory_write`, JSON.stringify(args)))
    expect(safe).toEqual({ platform, appId: args.appId, topic: args.topic, status: 'deprecated' })
    expect(resolve(`${family}_memory_write`)).toBe('memory_write')
    const { container, rerender } = render(<Presenter op="memory_write" params={safe} isStreaming={false} result={JSON.stringify({ saved: true, ...safe })} />)
    expect(screen.getByText('Memory Archived')).toBeTruthy()
    expect(screen.getByText(`${platform}/com.example.app/search`)).toBeTruthy()
    expect(container.querySelector(icon)).toBeTruthy()
    rerender(<Presenter op="memory_read" params={safe} isStreaming={false} result={JSON.stringify({ content: 'Observe fresh state.' })} />)
    fireEvent.click(screen.getByText('Memory Read'))
    expect(screen.getByText('Observe fresh state.')).toBeTruthy()
  })
})
