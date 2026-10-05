/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseSchemaForm } from '@superone/shared/schema-form'
import type { InputRequestMeta } from '@superone/shared/input-request'
import { InputRequestForm } from './InputRequestPrompt'

const meta: InputRequestMeta = {
  title: 'Review notes', description: 'Add the details to return to the caller.',
  origin: { kind: 'agent' }, output: 'caller', submitLabel: 'Save Notes',
}
const form = parseSchemaForm({ type: 'object', required: ['notes'], properties: { notes: { type: 'string', title: 'Notes' } } })

describe('InputRequestForm', () => {
  it('uses the caller label and keeps a failed submission editable for retry', async () => {
    const submit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<div data-chat-root><InputRequestForm meta={meta} form={form} onSubmit={submit} onCancel={vi.fn()} /></div>)
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull()
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'First line\nSecond line' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save Notes/ }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText(/Notes/)).toHaveValue('First line\nSecond line')
    fireEvent.click(screen.getByRole('button', { name: /^Save Notes/ }))
    await act(async () => {})
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenLastCalledWith({ notes: 'First line\nSecond line' })
  })

  it('submits once while the host is answering and cancels without values', async () => {
    let finish!: (value: boolean) => void
    const submit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve }))
    const cancel = vi.fn().mockResolvedValue(true)
    render(<div data-chat-root><InputRequestForm meta={meta} form={form} onSubmit={submit} onCancel={cancel} /></div>)
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Ready' } })
    const button = screen.getByRole('button', { name: /^Save Notes/ })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.keyDown(screen.getByLabelText(/Notes/), { key: 'Enter' })
    expect(submit).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    await act(async () => { finish(true) })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => {})
    expect(cancel).toHaveBeenCalledWith()
  })

  it('ignores an outgoing inactive form', () => {
    const submit = vi.fn()
    const cancel = vi.fn()
    render(<div data-chat-root><InputRequestForm meta={meta} form={form} active={false} onSubmit={submit} onCancel={cancel} /></div>)
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'stale' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save Notes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(submit).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })
})
