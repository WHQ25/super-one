/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { parseSchemaForm } from '@superone/shared/schema-form'
import { SchemaFormComposer } from './SchemaFormComposer'

function renderForm(schema: unknown, extra: { allowAlways?: boolean } = {}) {
  const handlers = { onSubmit: vi.fn(), onDecline: vi.fn(), onCancel: vi.fn() }
  render(<SchemaFormComposer form={parseSchemaForm(schema)} requester="Bits & Bolts" {...handlers} {...extra} />)
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
    expect(onSubmit).toHaveBeenCalledWith({ reference: 'cad://parts/hex', tolerance: 2.5, approved: false }, false)
  })

  it('reveals errors instead of submitting invalid answers', () => {
    const { onSubmit } = renderForm(REVIEW)
    fireEvent.change(screen.getByLabelText(/CAD or file URI/), { target: { value: 'https://x.y' } })
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('picks thumbnail options and offers always-allow when asked', () => {
    const { onSubmit } = renderForm({
      type: 'object',
      required: ['part'],
      properties: {
        part: { type: 'string', title: 'Part', oneOf: [
          { const: 'hex', title: 'Hex bolt', 'x-openai-thumbnail': { src: 'https://example.com/hex.png' } },
          { const: 'washer', title: 'Washer' },
        ] },
      },
    }, { allowAlways: true })
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    fireEvent.click(screen.getByRole('radio', { name: /Washer/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit and Always Allow' }))
    expect(onSubmit).toHaveBeenCalledWith({ part: 'washer' }, true)
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
    expect(onSubmit).toHaveBeenCalledWith({ refs: ['cad://a', 'cad://b'] }, false)
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
    expect(onSubmit).toHaveBeenCalledWith({ tags: ['custom-spacer', 'washer'] }, false)
  })

  it('declines and cancels without content', () => {
    const { onDecline, onCancel, onSubmit } = renderForm(REVIEW)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDecline).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
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
