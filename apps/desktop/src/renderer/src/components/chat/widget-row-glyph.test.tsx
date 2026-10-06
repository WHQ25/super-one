/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import type { ChatMessage } from '@superone/shared/agent-types'

/**
 * Widget tool rows draw the glyph of the widget mention chip. Other SuperOne rows keep the
 * server's brand icon, so the brand is resolvable in every case here.
 */
const BRAND = 'data:image/png;base64,iVBORw0KGgo='

function renderRow(toolName: string, input: string, status: 'streaming' | 'complete') {
  const message = {
    id: 'turn-1', role: 'assistant', status: 'complete', createdAt: '2026-01-01T00:00:00.000Z', providerId: 'claude',
    content: [{ type: 'tool_use', toolName, toolUseId: 't', input, status }],
  } as ChatMessage
  return render(<PortableMessage message={message} scheme="dark" pendingPermission={null} mcpIcons={{ superone: BRAND }} />)
}

describe('the widget glyph on widget tool rows', () => {
  it.each(['streaming', 'complete'] as const)('replaces the server brand on a %s widget_show row', (status) => {
    const { container } = renderRow('mcp__superone__widget_show', '{"title":"releases","widget_code":"<div>Rel', status)
    expect(container.querySelector('.lucide-layout-dashboard')).not.toBeNull()
    expect(container.querySelector(`img[src="${BRAND}"]`)).toBeNull()
  })

  it.each([
    ['widget_list_templates', '{}'],
    ['widget_save', '{"id":"releases","title":"Releases","code":"<div/>"}'],
  ])('replaces the server brand on the %s row', (tool, input) => {
    const { container } = renderRow(`mcp__superone__${tool}`, input, 'complete')
    expect(container.querySelector('.lucide-layout-dashboard')).not.toBeNull()
    expect(container.querySelector(`img[src="${BRAND}"]`)).toBeNull()
  })

  it('leaves the server brand on the other SuperOne rows', () => {
    const { container } = renderRow('mcp__superone__config_read', '{"domain":"appearance"}', 'complete')
    expect(container.querySelector(`img[src="${BRAND}"]`)).not.toBeNull()
  })
})
