/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseSchemaForm } from '@superone/shared/schema-form'
import { SchemaFormComposer } from './SchemaFormComposer'
import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import type { McpAppReadResult } from '@superone/shared/mcp-apps'

function renderForm(schema: unknown) {
  const handlers = { onSubmit: vi.fn(), onDecline: vi.fn(), onCancel: vi.fn() }
  render(<SchemaFormComposer form={parseSchemaForm(schema)} requester="Bits & Bolts" {...handlers} />)
  return handlers
}

const REVIEW = {
  type: 'object',
  required: ['reference', 'tolerance'],
  properties: {
    reference: { type: 'string', title: 'CAD or file URI', format: 'uri', pattern: '^(cad|file):' },
    tolerance: { type: 'number', title: 'Tolerance (mm)', minimum: 0, maximum: 10 },
    approved: { type: 'boolean', title: 'Approved' },
  },
}

describe('SchemaFormComposer', () => {
  it('submits typed content once every field is valid', () => {
    const { onSubmit } = renderForm(REVIEW)
    fireEvent.change(screen.getByLabelText(/CAD or file URI/), { target: { value: 'cad://parts/hex' } })
    fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({ reference: 'cad://parts/hex', tolerance: 2.5, approved: false })
  })

  it('reveals errors instead of submitting invalid answers', () => {
    const { onSubmit } = renderForm(REVIEW)
    fireEvent.change(screen.getByLabelText(/CAD or file URI/), { target: { value: 'https://x.y' } })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('picks thumbnail options', () => {
    const { onSubmit } = renderForm({
      type: 'object',
      required: ['part'],
      properties: {
        part: { type: 'string', title: 'Part', oneOf: [
          { const: 'hex', title: 'Hex bolt', 'x-openai-thumbnail': { src: 'https://example.com/hex.png' } },
          { const: 'washer', title: 'Washer' },
        ] },
      },
    })
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    fireEvent.click(screen.getByRole('radio', { name: /Washer/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({ part: 'washer' })
  })

  it('selects supplied resources only', () => {
    const { onSubmit } = renderForm({
      type: 'object',
      properties: {
        refs: {
          type: 'array', items: { type: 'string', format: 'uri' },
          'x-openai-input': { type: 'resource', selection: 'explicit', options: [{ uri: 'cad://a', name: 'a.stl' }, { uri: 'cad://b', name: 'b.stl' }] },
          default: ['cad://a'],
        },
      },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.stl/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({ refs: ['cad://a', 'cad://b'] })
  })

  it('adds free-text list values with Enter and from suggestions', () => {
    const { onSubmit } = renderForm({
      type: 'object',
      properties: { tags: { type: 'array', title: 'Tags', items: { type: 'string', 'x-openai-suggestions': [{ const: 'washer', title: 'Washer' }] } } },
    })
    const input = screen.getByLabelText('Tags')
    fireEvent.change(input, { target: { value: 'custom-spacer' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Washer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({ tags: ['custom-spacer', 'washer'] })
  })

  it('declines and cancels without content', () => {
    const { onDecline, onCancel, onSubmit } = renderForm(REVIEW)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDecline).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('mounts a form whose default defeats a backtracking regex without stalling', () => {
    const start = performance.now()
    const { onSubmit } = renderForm({
      type: 'object',
      properties: { code: { type: 'string', title: 'Code', pattern: '^(a+)+$', default: `${'a'.repeat(5000)}!` } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText("Doesn't match the expected format")).toBeTruthy()
    expect(performance.now() - start).toBeLessThan(2000)
  })

  it('shows none of an unsupported form and only lets it be dismissed', () => {
    const { onCancel } = renderForm({
      type: 'object',
      properties: { note: { type: 'string', title: 'Note' }, when: { type: 'string', format: 'color' } },
    })
    expect(screen.queryByText('Note')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})

const resourceOptions = [
  { uri: 'cad://a', name: 'a.stl', _meta: { 'openai/preview': { target: { type: 'resource_link', uri: 'cad://preview/a', name: 'A' } } } },
  { uri: 'cad://b', name: 'b.stl', _meta: { 'openai/preview': { target: { type: 'resource_link', uri: 'cad://preview/b', name: 'B' } } } },
  { uri: 'cad://tool', name: 'tool.stl', _meta: { 'openai/preview': { target: { type: 'mcp_app_tool', name: 'cad.open' } } } },
]
function resourceComposer(resources: McpFormResourceActions | undefined, implicit = false) {
  const form = parseSchemaForm({ type: 'object', properties: { refs: {
    type: 'array', title: 'References', items: { type: 'string', format: 'uri' },
    'x-openai-input': { type: 'resource', selection: implicit ? 'implicit' : 'explicit', options: resourceOptions, userOptions: { accept: ['.stl'] } },
  } } }, { userResources: true })
  const handlers = { onSubmit: vi.fn(), onDecline: vi.fn(), onCancel: vi.fn() }
  const rendered = render(<SchemaFormComposer form={form} resources={resources} requester="Bits & Bolts" {...handlers} />)
  return { ...handlers, ...rendered }
}

describe('SchemaFormComposer native resources', () => {
  it('submits only remaining implicit options plus picked files and permits removing both', async () => {
    const pick = vi.fn(async () => [{ uri: 'file:///part.stl', name: 'part.stl' }])
    const { onSubmit } = resourceComposer({ pick, preview: vi.fn() }, true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.stl' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add b.stl' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.stl' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove part.stl' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Remove tool.stl' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({ refs: ['cad://a', 'file:///part.stl'] })
    expect(pick).toHaveBeenCalledWith('refs')
  })
  it('keeps existing answers on dialog cancel and reports picker refusal without disabling server choices', async () => {
    const pick = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('File type denied'))
    const { onSubmit } = resourceComposer({ pick, preview: vi.fn() })
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.stl/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
    await screen.findByText('File type denied')
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.stl/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({ refs: ['cad://a', 'cad://b'] })
  })
  it('disables submit while picking and discards a late result after this request unmounts', async () => {
    let answer!: (result: Array<{ uri: string; name: string }>) => void
    const pick = vi.fn(() => new Promise<Array<{ uri: string; name: string }>>(resolve => { answer = resolve }))
    const { onSubmit, unmount } = resourceComposer({ pick, preview: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    await act(async () => { answer([{ uri: 'file:///late.stl', name: 'late.stl' }]) })
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('renders resource text as inert data without changing selection; tool previews stay absent', async () => {
    const preview = vi.fn(async () => ({ contents: [{ uri: 'cad://preview/a', text: '<script>danger()</script>' }] }))
    const { onSubmit, container } = resourceComposer({ pick: vi.fn(), preview })
    expect(screen.queryByRole('button', { name: 'Preview tool.stl' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Preview a.stl' }))
    expect(screen.getByRole('status')).toBeTruthy()
    await screen.findByText('<script>danger()</script>')
    expect(container.querySelector('script')).toBeNull()
    expect(preview).toHaveBeenCalledWith('refs', 'cad://a')
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).toHaveBeenCalledWith({})
  })
  it('ignores an older preview after switching options and keeps error options selectable', async () => {
    let first!: (result: McpAppReadResult) => void
    const preview = vi.fn().mockImplementationOnce(() => new Promise<McpAppReadResult>(resolve => { first = resolve }))
      .mockRejectedValueOnce(new Error('Server unavailable'))
    resourceComposer({ pick: vi.fn(), preview })
    fireEvent.click(screen.getByRole('button', { name: 'Preview a.stl' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview b.stl' }))
    await screen.findByText('Server unavailable')
    await act(async () => { first({ contents: [{ uri: 'cad://preview/a', text: 'stale details' }] }) })
    expect(screen.queryByText('stale details')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.stl/ }))
    expect(screen.getByRole('checkbox', { name: /b\.stl/ }).getAttribute('aria-checked')).toBe('true')
  })
  it('refuses implicit selection when this client has no native picker', () => {
    resourceComposer(undefined, true)
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })
})
