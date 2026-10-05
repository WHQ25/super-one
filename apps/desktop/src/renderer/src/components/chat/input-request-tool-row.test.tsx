/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'
import { InputRequestToolRow } from '@superone/chat-view/presenters/InputRequestToolRow'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'

it('projects the form title without its schema or draft values', () => {
  expect(JSON.parse(sanitizeRemoteToolInput('mcp__superone__composer_request', JSON.stringify({ title: 'Review', requestedSchema: { secret: 'hidden' } })))).toEqual({ title: 'Review' })
})

it('renders the portable tool as status and title without duplicating the editable form', () => {
  const view = render(<PortableToolRow toolName="mcp__superone__composer_request" input='{"title":"Review"}' status="streaming" />)
  expect(screen.getByText('Waiting for input…')).toBeInTheDocument()
  expect(screen.getByText('Review')).toBeInTheDocument()
  expect(view.container.querySelector('input,textarea,button')).toBeNull()
  view.rerender(<PortableToolRow toolName="mcp__superone__composer_request" input='{"title":"Review"}' status="complete" result='{"status":"cancelled","reason":"user"}' />)
  expect(screen.getByText('Input Cancelled')).toBeInTheDocument()
  expect(view.container.querySelector('.errored,.denied')).toBeNull()
})

it('recognizes submitted outcomes in MCP envelopes and truncated remote results', () => {
  const view = render(<InputRequestToolRow streaming={false} result={JSON.stringify({ content: [{ type: 'text', text: '{"status":"submitted","values":{"notes":"private"}}' }] })} />)
  expect(screen.getByText('Input Submitted')).toBeInTheDocument()
  expect(screen.queryByText(/private/)).toBeNull()
  view.rerender(<InputRequestToolRow streaming={false} result='{"status":"submitted","values":{"notes":"truncated' />)
  expect(screen.getByText('Input Submitted')).toBeInTheDocument()
})
