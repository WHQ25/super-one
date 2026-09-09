/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableMessage } from '@superone/chat-view/PortableMessage'
import { SUPERONE_TOOL_DESCRIPTORS } from '@superone/chat-view/presenters/superone-tool-display'
import { applyContentDelta } from '@superone/shared/content-delta'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

/**
 * SuperOne's own MCP tools that render as a verb plus a subject. `tool-display.ts`
 * answers `{ icon: 'plug', summary: '' }` for anything starting with `mcp__`, so
 * before the descriptors were shared these arrived on the phone as an unlabelled
 * row — the desktop's table and its inline branches lived in the renderer only.
 *
 * Each case goes through the real `sanitizeRemoteToolInput`, because a labelled row
 * with an empty subject is the *other* half of this bug: the projection has to keep
 * the fields the descriptor reads, and nothing else fails if it does not.
 */
function projectedRow(toolName: string, input: Record<string, unknown>, result?: string) {
  const full = `mcp__superone__${toolName}`
  const call = {
    type: 'tool_use',
    toolName: full,
    toolUseId: `${toolName}-1`,
    status: 'streaming',
    input: sanitizeRemoteToolInput(full, JSON.stringify(input)),
  } as ContentBlock
  const content = applyContentDelta(
    [call],
    { type: 'tool_result', toolUseId: `${toolName}-1`, summary: result ?? '' } as ContentBlock,
  )
  const message = {
    id: 'turn-1',
    role: 'assistant',
    status: 'complete',
    createdAt: '2026-01-01T00:00:00.000Z',
    providerId: 'claude',
    content,
  } as ChatMessage
  // Through the turn body, not `PortableToolRow` directly: SuperOne's tool dispatch
  // lives in the adapters that mount it, and the row is only the fall-through leaf.
  return render(
    <PortableMessage
      message={message}
      scheme="dark"
      pendingPermission={null}
      isLastAssistant
      sessionStreaming={false}
    />,
  )
}

describe('SuperOne compact tool rows on the phone', () => {
  it('names a settings read by the domain the result reports', () => {
    const { container } = projectedRow('config_read', { domain: 'appearance' }, JSON.stringify({ label: 'Appearance' }))
    expect(container.textContent).toContain('Settings Read')
    expect(container.textContent).toContain('Appearance')
  })

  it('falls back to the projected domain when the result was truncated away', () => {
    const { container } = projectedRow('config_read', { domain: 'appearance' }, 'not json at all…')
    expect(container.textContent).toContain('appearance')
  })

  it('calls a domainless config_read the overview, as the desktop does', () => {
    const { container } = projectedRow('config_read', {})
    expect(container.textContent).toContain('Settings Read')
    expect(container.textContent).toContain('Overview')
  })

  it('shows a manual read as domain/topic', () => {
    const { container } = projectedRow('read_manual', { domain: 'widget', topic: 'mockup' })
    expect(container.textContent).toContain('widget/mockup')
  })

  it('lists the tags a session_tag applied', () => {
    const { container } = projectedRow('session_tag', { add: ['mobile-ui', 'composer'] })
    expect(container.textContent).toContain('mobile-ui, composer')
  })

  it('counts bulk tag targets without carrying the session ids', () => {
    const projected = sanitizeRemoteToolInput(
      'mcp__superone__session_tag',
      JSON.stringify({ add: ['triage'], sessionIds: ['sess-a', 'sess-b', 'sess-c'] }),
    )
    expect(projected).not.toContain('sess-a')

    const { container } = projectedRow('session_tag', { add: ['triage'], sessionIds: ['sess-a', 'sess-b', 'sess-c'] })
    expect(container.textContent).toContain('triage · 3')
  })

  it('names a mini-app types update by its directory leaf', () => {
    const { container } = projectedRow('miniapp_dev_update_types', { appDir: '/Users/me/apps/budget-tracker' })
    expect(container.textContent).toContain('budget-tracker')
    expect(container.textContent).not.toContain('/Users/me')
  })

  it('labels a widget template listing instead of leaving a bare plug row', () => {
    const { container } = projectedRow('widget_list_templates', {})
    expect(container.textContent?.trim()).not.toBe('')
    expect(container.textContent).toMatch(/template/i)
  })

  it('renders the mini-app setup card with the fields the projection kept', () => {
    const { container } = projectedRow(
      'miniapp_dev_setup',
      { name: 'budget', directory: '/Users/me/apps/budget', description: 'Tracks spend' },
    )
    expect(container.textContent).toContain('budget')
  })

  it('keeps every field the descriptors read through the remote projection', () => {
    // The guard for the failure mode with no symptom: a descriptor reads a field the
    // sanitizer drops, and only the phone shows an empty subject.
    const samples: Record<string, Record<string, unknown>> = {
      config_read: { domain: 'appearance' },
      read_manual: { domain: 'widget', topic: 'mockup' },
      session_tag: { add: ['a'] },
      miniapp_dev_register: { name: 'budget' },
      miniapp_dev_update_types: { appDir: '/apps/budget' },
    }
    for (const [tool, input] of Object.entries(samples)) {
      const projected = sanitizeRemoteToolInput(`mcp__superone__${tool}`, JSON.stringify(input))
      const params = JSON.parse(projected || '{}') as Record<string, unknown>
      const summary = SUPERONE_TOOL_DESCRIPTORS[tool].summary?.(params, null) ?? ''
      expect(summary, `${tool} lost its subject in the projection`).not.toBe('')
    }
  })
})
