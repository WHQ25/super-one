/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { encodeMcpMentionValue, formatMcpResourceReminder, wrapMcpResourceMention } from '@superone/shared/mcp-app-mentions'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { McpMentionSentTap } from '@superone/chat-view/presenters/McpMentionCard'

const bolt = encodeMcpMentionValue('bits', 'cad://parts/hex-bolt')
const nut = encodeMcpMentionValue('bits', 'cad://parts/hex-nut')
const text = `Compare ${wrapMcpResourceMention(bolt, 'Hex bolt')} with ${wrapMcpResourceMention(nut, 'Hex nut')}`
  + formatMcpResourceReminder([{ server: 'bits', uri: 'cad://parts/hex-bolt', text: 'Grade 8.8 stainless' }])

function message() {
  const sent: ChatMessage = { id: 'u1', role: 'user', providerId: 'claude', status: 'complete', createdAt: '', content: [{ type: 'text', text }] }
  return render(<PortableMessage message={sent} scheme="dark" pendingPermission={null} />)
}

/** The phone has no hover, so a sent MCP chip opens the desktop's card on tap. */
describe('a sent MCP chip in the portable transcript', () => {
  it('opens the text the message carried for it', async () => {
    message()
    expect(screen.queryByText('Grade 8.8 stainless')).toBeNull()
    fireEvent.click(screen.getByTitle(bolt))
    expect(await screen.findByText('Grade 8.8 stainless')).toBeTruthy()
    expect(screen.getAllByText('cad://parts/hex-bolt').length).toBeGreaterThan(0)
  })

  it('says only the link went when nothing was inlined', async () => {
    message()
    fireEvent.click(screen.getByTitle(nut))
    expect(await screen.findByText(/Only the link was sent/)).toBeTruthy()
  })

  it('stays a plain chip outside a message', () => {
    render(<McpMentionSentTap value={bolt}><span>Hex bolt</span></McpMentionSentTap>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
