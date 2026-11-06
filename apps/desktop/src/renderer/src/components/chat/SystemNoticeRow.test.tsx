/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SystemNoticeRow } from '@superone/chat-view/presenters/SystemNoticeRow'
import { findLastAssistantMessageId } from '@superone/chat-view/presenters/ChatMessageIndicators'
import type { ChatMessage } from '@superone/shared/agent-types'
import i18n from 'i18next'

describe('provider system notices', () => {
  it('translates host-generated storage warnings when the viewing client uses Chinese', async () => {
    await i18n.changeLanguage('zh')
    try {
      render(<SystemNoticeRow meta={{ source: 'Claude Code', kind: 'storage', level: 'warning', code: 'EDQUOT', details: { lost: ['transcript'] } }} text="Stored English fallback" />)
      expect(screen.getByRole('note')).toHaveTextContent('磁盘配额已用完')
      expect(screen.getByRole('note')).toHaveTextContent('会话记录')
      expect(screen.queryByText('Stored English fallback')).toBeNull()
    } finally { await i18n.changeLanguage('en') }
  })

  it('shows warning text literally and makes affected-session diagnostics expandable', () => {
    const { container } = render(<SystemNoticeRow meta={{ source: 'Claude Code', level: 'warning', code: 'ENOSPC', details: { transcriptSessionIds: ['old-session'] } }} text={'<b>not markup</b> [not a link](https://example.com)'} />)
    expect(screen.getByRole('note')).toHaveAttribute('data-system-notice', 'warning')
    expect(screen.getByText(/<b>not markup<\/b>/)).toBeInTheDocument()
    expect(container.querySelector('b, a')).toBeNull()
    const details = container.querySelector('details')!
    expect(details.open).toBe(false)
    fireEvent.click(container.querySelector('summary')!)
    expect(details.open).toBe(true)
    expect(screen.getByText(/old-session/)).toBeInTheDocument()
  })

  it('leaves the actual streaming reply as the last assistant when a notice arrives', () => {
    const reply = { id: 'reply', role: 'assistant', status: 'streaming', content: [] } as unknown as ChatMessage
    const notice = { ...reply, id: 'notice', providerId: 'system', status: 'complete', metadata: { systemNotice: { source: 'Claude Code', level: 'warning' } } } as ChatMessage
    expect(findLastAssistantMessageId([reply, notice])).toBe('reply')
  })
})
