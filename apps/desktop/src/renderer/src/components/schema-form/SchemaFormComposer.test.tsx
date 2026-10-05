/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { parseSchemaForm } from '@superone/shared/schema-form'
import { SchemaFormComposer, type SchemaFormComposerDraft } from './SchemaFormComposer'
import type { McpFormResourceActions } from '@superone/shared/mcp-form-resources'
import type { McpAppReadResult } from '@superone/shared/mcp-apps'
import { ChatRootContext } from '../chat/is-focus-in-chat'
import { noteChatInputFocused } from '../chat/composer-slot/decision-composer-policy'

function renderForm(schema: unknown) {
  const handlers = { onSubmit: vi.fn(), onDecline: vi.fn(), onCancel: vi.fn() }
  render(<div data-chat-root><SchemaFormComposer form={parseSchemaForm(schema)} requester="Bits & Bolts" {...handlers} /></div>)
  return handlers
}

/** Keys reach the composer's window listener from whatever holds focus. */
function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key })
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
  it('restores typed answers and the current step after a higher-priority prompt unmounts it', () => {
    const form = parseSchemaForm({ type: 'object', required: ['notes', 'priority'], properties: {
      notes: { type: 'string', title: 'Notes' },
      priority: { type: 'string', title: 'Priority', enum: ['low', 'high'] },
    } })
    let draft: SchemaFormComposerDraft | undefined
    const onDraftChange = (value: SchemaFormComposerDraft) => { draft = value }
    const handlers = { onSubmit: vi.fn(), onCancel: vi.fn() }
    const view = render(<div data-chat-root><SchemaFormComposer form={form} requester="agent" {...handlers} onDraftChange={onDraftChange} /></div>)
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Keep this\nand this' } })
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }))
    view.unmount()
    render(<div data-chat-root><SchemaFormComposer form={form} requester="agent" {...handlers} draft={draft} onDraftChange={onDraftChange} /></div>)
    expect(screen.getByLabelText('Step 2 of 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /high/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
    expect(handlers.onSubmit).toHaveBeenCalledWith({ notes: 'Keep this\nand this', priority: 'high' })
  })

  it('leaves recent composer focus alone on arrival, but focuses the next step after a user pick', () => {
    const root = createRef<HTMLDivElement>()
    const form = parseSchemaForm({ type: 'object', properties: {
      priority: { type: 'string', title: 'Priority', enum: ['low', 'high'] },
      note: { type: 'string', title: 'Note' },
    } })
    const view = (show: boolean) => (
      <ChatRootContext.Provider value={root}>
        <div ref={root} data-chat-root>
          <textarea aria-label="Composer draft" data-chat-input-editor defaultValue="Unsent draft" />
          {show && <SchemaFormComposer form={form} requester="fixture" onSubmit={vi.fn()} onDecline={vi.fn()} onCancel={vi.fn()} />}
        </div>
      </ChatRootContext.Provider>
    )
    const { rerender } = render(view(false))
    const editor = screen.getByRole('textbox', { name: 'Composer draft' })
    editor.focus()
    noteChatInputFocused(root.current!)
    rerender(view(true))
    expect(editor).toHaveFocus()
    fireEvent.click(screen.getByRole('radio', { name: /high/ }))
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveFocus()
  })

  it('keeps free-text newlines in elicitation answers and preserves short and formatted fields', () => {
    const { onSubmit } = renderForm({ type: 'object', properties: {
      note: { type: 'string', title: 'Note' },
      name: { type: 'string', title: 'Name', maxLength: 40 },
      email: { type: 'string', title: 'Email', format: 'email' },
    } })
    const note = screen.getByLabelText('Note') as HTMLTextAreaElement
    expect(note.tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('Name').tagName).toBe('INPUT')
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    fireEvent.change(note, { target: { value: 'Check the dimensions' } })
    note.setSelectionRange(note.value.length, note.value.length)
    fireEvent.keyDown(note, { key: 'Enter', altKey: true })
    fireEvent.change(note, { target: { value: `${note.value}Keep the original material` } })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith({ note: 'Check the dimensions\nKeep the original material' })
  })

  it('asks typed fields together, then each choice, and submits on the last step', () => {
    const { onSubmit } = renderForm(REVIEW)
    expect(screen.getByLabelText('Step 1 of 2')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'Approved' })).toBeNull()
    fireEvent.change(screen.getByLabelText(/CAD or file URI/), { target: { value: 'cad://parts/hex' } })
    fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByRole('radio', { name: /No/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }))
    expect(onSubmit).toHaveBeenCalledWith({ reference: 'cad://parts/hex', tolerance: 2.5, approved: false })
  })

  it('reveals the step errors instead of moving on', () => {
    const { onSubmit } = renderForm(REVIEW)
    fireEvent.change(screen.getByLabelText(/CAD or file URI/), { target: { value: 'https://x.y' } })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByLabelText('Step 1 of 2')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('moves on with digit picks, goes back with answers kept, and submits with Enter', () => {
    const { onSubmit } = renderForm({
      type: 'object',
      required: ['priority', 'note'],
      properties: {
        priority: { type: 'string', title: 'Priority', enum: ['low', 'normal', 'high'] },
        approved: { type: 'boolean', title: 'Approved' },
        note: { type: 'string', title: 'Note' },
      },
    })
    press('2')
    expect(screen.getByLabelText('Step 2 of 3')).toBeTruthy()
    press('1')
    const note = screen.getByLabelText(/Note/)
    expect(document.activeElement).toBe(note)
    // Digits typed into a field stay text.
    fireEvent.keyDown(note, { key: '3' })
    expect(screen.getByLabelText('Step 3 of 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('radio', { name: /Yes/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }))
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'ship it' } })
    press('Enter')
    expect(onSubmit).toHaveBeenCalledWith({ priority: 'normal', approved: true, note: 'ship it' })
  })

  describe('two-digit option numbers', () => {
    const MANY = {
      type: 'object',
      required: ['part'],
      properties: { part: { type: 'string', title: 'Part', enum: Array.from({ length: 23 }, (_, i) => `part-${i + 1}`) } },
    }
    const checked = (name: string) => screen.getByRole('radio', { name }).getAttribute('aria-checked')

    it('waits on a digit that could start a longer number, then completes it', () => {
      renderForm(MANY)
      press('2')
      expect(checked('part-2')).toBe('false')
      expect(screen.getByText('2_')).toBeTruthy()
      press('3')
      expect(checked('part-23')).toBe('true')
      expect(screen.queryByText('2_')).toBeNull()
    })

    it('picks the waiting number after the pause, or at once with Enter', () => {
      vi.useFakeTimers()
      try {
        renderForm(MANY)
        press('1')
        act(() => { vi.advanceTimersByTime(700) })
        expect(checked('part-1')).toBe('true')
        press('2')
        press('Enter')
        expect(checked('part-2')).toBe('true')
      } finally { vi.useRealTimers() }
    })

    it('picks at once when no longer number exists, and restarts on a digit that cannot continue', () => {
      renderForm(MANY)
      press('5')
      expect(checked('part-5')).toBe('true')
      press('2')
      press('7')
      expect(checked('part-7')).toBe('true')
    })

    it('lets Backspace and Escape undo typed digits without cancelling the form', () => {
      const { onCancel, onSubmit } = renderForm(MANY)
      press('2')
      press('Backspace')
      expect(screen.queryByText('2_')).toBeNull()
      press('1')
      press('Escape')
      expect(screen.queryByText('1_')).toBeNull()
      expect(onCancel).not.toHaveBeenCalled()
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true)
    })

    it('numbers supplied resources and toggles them by number', () => {
      const { onSubmit } = renderForm({
        type: 'object',
        properties: { refs: { type: 'array', items: { type: 'string', format: 'uri' },
          'x-openai-input': { type: 'resource', selection: 'explicit', options: [{ uri: 'cad://a', name: 'a.stl' }, { uri: 'cad://b', name: 'b.stl' }] } } },
      })
      press('2')
      press('Enter')
      expect(onSubmit).toHaveBeenCalledWith({ refs: ['cad://b'] })
    })
  })

  it('leaves a field with Escape, then cancels the form', () => {
    const { onCancel } = renderForm(REVIEW)
    const reference = screen.getByLabelText(/CAD or file URI/)
    expect(document.activeElement).toBe(reference)
    press('Escape')
    expect(document.activeElement).not.toBe(reference)
    expect(onCancel).not.toHaveBeenCalled()
    press('Escape')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('leaves keys typed outside the form alone', () => {
    const { onSubmit, onCancel } = renderForm({ type: 'object', properties: { priority: { type: 'string', enum: ['low', 'high'] } } })
    const elsewhere = document.createElement('textarea')
    document.querySelector('[data-chat-root]')!.appendChild(elsewhere)
    elsewhere.focus()
    for (const key of ['1', 'Enter', 'Escape']) fireEvent.keyDown(elsewhere, { key })
    expect(screen.getByRole('radio', { name: /low/ }).getAttribute('aria-checked')).toBe('false')
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
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
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
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
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
    expect(onSubmit).toHaveBeenCalledWith({ refs: ['cad://a', 'file:///part.stl'] })
    expect(pick).toHaveBeenCalledWith('refs')
  })
  it('keeps existing answers on dialog cancel and reports picker refusal without disabling server choices', async () => {
    const pick = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('File type denied'))
    const { onSubmit } = resourceComposer({ pick, preview: vi.fn() })
    fireEvent.click(screen.getByRole('checkbox', { name: /a\.stl/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
    await waitFor(() => expect((screen.getByRole('button', { name: /^Submit/ }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
    await screen.findByText('File type denied')
    fireEvent.click(screen.getByRole('checkbox', { name: /b\.stl/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
    expect(onSubmit).toHaveBeenCalledWith({ refs: ['cad://a', 'cad://b'] })
  })
  it('disables submit while picking and discards a late result after this request unmounts', async () => {
    let answer!: (result: Array<{ uri: string; name: string }>) => void
    const pick = vi.fn(() => new Promise<Array<{ uri: string; name: string }>>(resolve => { answer = resolve }))
    const { onSubmit, unmount } = resourceComposer({ pick, preview: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
    expect((screen.getByRole('button', { name: /^Submit/ }) as HTMLButtonElement).disabled).toBe(true)
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
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
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
    expect(screen.queryByRole('button', { name: /^Submit/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
  })
})
