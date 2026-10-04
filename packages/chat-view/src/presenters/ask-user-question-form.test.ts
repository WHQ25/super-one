// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { AskUserQuestionRequest } from '@superone/shared/agent-types'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
import { AskUserQuestionForm, type AskUserQuestionFormProps } from './AskUserQuestionForm'

const request: AskUserQuestionRequest = {
  requestId: 'q-1',
  previewFormat: 'markdown',
  questions: [{
    question: 'Which layout?', header: 'Layout', multiSelect: false,
    options: [{ label: 'Compact', description: '', preview: 'compact preview' }, { label: 'Comfortable', description: '', preview: 'comfortable preview' }],
  }],
}

let root: Root | undefined, container: HTMLDivElement | undefined
afterEach(async () => { await act(async () => root?.unmount()); container?.remove() })

async function mount(props: Partial<AskUserQuestionFormProps> = {}) {
  const onSubmit = vi.fn()
  const onDismiss = vi.fn()
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  await act(async () => root!.render(createElement(AskUserQuestionForm, {
    request, onSubmit, onDismiss, renderPreview: ({ content }) => createElement('p', { 'data-preview': '' }, content), ...props,
  })))
  const button = (name: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!
  return { onSubmit, onDismiss, button }
}

const type = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

it('touch: no shortcut hints, a Dismiss button, and keys do nothing', async () => {
  const { onDismiss, button } = await mount()
  expect(container!.textContent).not.toContain('chat.askUser.hintDismiss')
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(onDismiss).not.toHaveBeenCalled()
  await act(async () => button('chat.askUser.dismiss').click())
  expect(onDismiss).toHaveBeenCalledOnce()
})

it('preselects the first previewed option and submits its note', async () => {
  const { onSubmit, button } = await mount()
  expect(container!.querySelector('[data-preview]')?.textContent).toBe('compact preview')
  await type(container!.querySelector('input')!, 'denser')
  await act(async () => button('chat.askUser.submit').click())
  expect(onSubmit).toHaveBeenCalledWith({ 'Which layout?': 'Compact' }, { 'Which layout?': { notes: 'denser' } })
})

it('touch: the Other field comes last; typing an answer drops the pick, its preview and note', async () => {
  const { onSubmit, button } = await mount()
  const inputs = () => [...container!.querySelectorAll('input')]
  expect(inputs().map((i) => i.placeholder)).toEqual(['chat.askUser.noteOptionalPlaceholder', 'chat.askUser.otherOption'])
  await type(inputs().at(-1)!, ' neither ')
  expect(container!.querySelector('[data-preview]')).toBeNull()
  expect(inputs().map((i) => i.placeholder)).toEqual(['chat.askUser.otherOption'])
  await act(async () => button('chat.askUser.submit').click())
  expect(onSubmit).toHaveBeenCalledWith({ 'Which layout?': 'neither' }, undefined)
})

it('keyboard: shortcuts only while the host says keys are in scope', async () => {
  let inScope = false
  const { onSubmit } = await mount({ keyboard: { inScope: () => inScope } })
  expect(container!.textContent).toContain('chat.askUser.hintDismiss')
  expect(container!.textContent).not.toContain('chat.askUser.dismiss')
  const press = (key: string) => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key })) })
  await press('2')
  await press('Enter')
  expect(onSubmit).not.toHaveBeenCalled()
  inScope = true
  await press('2')
  await press('Enter')
  expect(onSubmit).toHaveBeenCalledWith({ 'Which layout?': 'Comfortable' }, undefined)
})

it('a blank Other answer does not count as one', async () => {
  const { button } = await mount()
  await type([...container!.querySelectorAll('input')].at(-1)!, '   ')
  expect(button('chat.askUser.submit').disabled).toBe(true)
})

it('answers once: after Submit neither Submit nor Dismiss responds again', async () => {
  const { onSubmit, onDismiss, button } = await mount()
  await act(async () => {
    button('chat.askUser.submit').click()
    button('chat.askUser.submit').click()
    button('chat.askUser.dismiss').click()
  })
  expect(onSubmit).toHaveBeenCalledOnce()
  expect(onDismiss).not.toHaveBeenCalled()
})

it('keyboard: leaves a key something else already took', async () => {
  const { onSubmit } = await mount({ keyboard: { inScope: () => true } })
  const take = (e: KeyboardEvent) => { if (e.key === '2') e.preventDefault() }
  window.addEventListener('keydown', take, true)
  try {
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', cancelable: true })) })
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) })
  } finally {
    window.removeEventListener('keydown', take, true)
  }
  expect(onSubmit).toHaveBeenCalledWith({ 'Which layout?': 'Compact' }, undefined)
})
