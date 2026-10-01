import { expect, jest, test } from '@jest/globals'
import { act, fireEvent, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { ReactElement } from 'react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { elicitationFormRequest } from '@superone/shared/schema-form'
import { renderWithTheme } from '../test-render'
import { PermissionSheet } from './PermissionSheet'

function withInsets(ui: ReactElement) {
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    {ui}
  </SafeAreaProvider>
}

function form(requestedSchema: unknown): PermissionRequest {
  return {
    requestId: 'form-1', toolName: 'bits-and-bolts', input: {}, allowAlwaysAllow: false,
    requestKind: 'mcp_elicitation', serverName: 'bits-and-bolts', message: 'Review a CAD reference',
    ...elicitationFormRequest(requestedSchema),
  }
}

test('an extended form submits typed content once it validates', async () => {
  const onAllow = jest.fn()
  await renderWithTheme(withInsets(<PermissionSheet perm={form({
    type: 'object',
    required: ['reference', 'tolerance'],
    properties: {
      reference: { type: 'string', title: 'CAD or file URI', format: 'uri', pattern: '^(cad|file):' },
      tolerance: { type: 'number', title: 'Tolerance (mm)', minimum: 0, maximum: 10 },
      part: { type: 'string', title: 'Part', oneOf: [{ const: 'hex', title: 'Hex bolt', description: 'Main joint' }, { const: 'washer', title: 'Washer' }] },
    },
  })} onAllow={onAllow} onDeny={() => {}} />))

  await act(async () => { fireEvent.changeText(screen.getByTestId('prompt-field-reference'), 'https://example.com') })
  expect(screen.getByText("Doesn't match the expected format")).toBeTruthy()
  expect(screen.getByTestId('prompt-approve')).toBeDisabled()

  await act(async () => {
    fireEvent.changeText(screen.getByTestId('prompt-field-reference'), 'cad://parts/hex')
    fireEvent.changeText(screen.getByTestId('prompt-field-tolerance'), '0.5')
    fireEvent.press(screen.getByTestId('prompt-option-Washer'))
  })
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })

  expect(onAllow).toHaveBeenCalledWith('form-1', { reference: 'cad://parts/hex', tolerance: 0.5, part: 'washer' }, false, undefined)
})

test('a resource picker returns the chosen supplied URIs', async () => {
  const onAllow = jest.fn()
  await renderWithTheme(withInsets(<PermissionSheet perm={form({
    type: 'object',
    properties: {
      refs: {
        type: 'array', items: { type: 'string', format: 'uri' },
        'x-openai-input': { type: 'resource', selection: 'explicit', options: [{ uri: 'cad://a', name: 'a.stl' }, { uri: 'cad://b', name: 'b.stl', title: 'Bracket' }] },
        default: ['cad://a'],
      },
    },
  })} onAllow={onAllow} onDeny={() => {}} />))

  await act(async () => { fireEvent.press(screen.getByTestId('prompt-option-cad://b')) })
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-approve')) })

  expect(onAllow).toHaveBeenCalledWith('form-1', { refs: ['cad://a', 'cad://b'] }, false, undefined)
})

test('an unsupported form shows none of its fields and can only be dismissed', async () => {
  const onDeny = jest.fn()
  await renderWithTheme(withInsets(<PermissionSheet perm={form({
    type: 'object',
    properties: { note: { type: 'string', title: 'Note' }, refs: { type: 'array', items: { type: 'string', format: 'uri' }, 'x-openai-input': { type: 'resource', selection: 'implicit', options: [] } } },
  })} onAllow={() => {}} onDeny={onDeny} />))

  expect(screen.queryByText('Note')).toBeNull()
  expect(screen.getByText("SuperOne can't show this form")).toBeTruthy()
  expect(screen.getByTestId('prompt-approve')).toBeDisabled()
  await act(async () => { fireEvent.press(screen.getByTestId('prompt-reject')) })
  expect(onDeny).toHaveBeenCalledWith('form-1', undefined)
})
