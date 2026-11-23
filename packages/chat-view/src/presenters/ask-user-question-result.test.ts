// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AskUserQuestionBlockPresenter,
  type AskUserQuestionBlockPresenterProps,
} from './AskUserQuestionResult'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
})

async function mount(props: Partial<AskUserQuestionBlockPresenterProps> = {}) {
  container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(AskUserQuestionBlockPresenter, {
      params: {},
      isStreaming: false,
      allowExpand: true,
      renderPreview: ({ content }) => createElement('div', { 'data-preview': '' }, content),
      ...props,
    }))
  })
  const button = (text: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
  return { button }
}

describe('AskUserQuestionBlockPresenter', () => {
  it('renders tabbed multi-question persistent card and lets user inspect other option descriptions', async () => {
    const { button } = await mount({
      toolUseId: 'auq-1',
      result: '"Which auth?"="JWT" "Which checks?"="Unit, E2E"',
      params: {
        questions: [
          {
            question: 'Which auth?',
            header: 'Auth',
            multiSelect: false,
            options: [
              { label: 'JWT', description: 'Stateless bearer tokens' },
              { label: 'Cookie', description: 'Server-side HTTP-only session' },
            ],
          },
          {
            question: 'Which checks?',
            header: 'Checks',
            multiSelect: true,
            options: [
              { label: 'Unit', description: 'Fast isolated tests' },
              { label: 'Lint', description: 'Static style rules' },
              { label: 'E2E', description: 'End-to-end verification' },
            ],
          },
        ],
        answers: {
          'Which auth?': 'JWT',
          'Which checks?': 'Unit, E2E',
        },
      },
    })

    expect(container!.querySelector('[data-ask-user-question-result="auq-1"]')).not.toBeNull()
    expect(button('Q1').textContent).toBe('Q1✓')
    expect(button('Q2').textContent).toBe('Q2✓')
    expect(button('JWT').getAttribute('data-selected')).toBe('true')
    expect(container!.textContent).toContain('Stateless bearer tokens')

    await act(async () => button('Cookie').click())
    expect(button('JWT').getAttribute('data-selected')).toBe('true')
    expect(button('Cookie').getAttribute('data-inspected')).toBe('true')
    expect(container!.textContent).toContain('Server-side HTTP-only session')

    await act(async () => button('Cookie').click())
    expect(container!.textContent).toContain('Stateless bearer tokens')
    expect(container!.textContent).not.toContain('Server-side HTTP-only session')

    await act(async () => button('Q2').click())
    expect(container!.textContent).toContain('Unit:Fast isolated tests')
    expect(container!.textContent).toContain('E2E:End-to-end verification')
    expect(container!.textContent).not.toContain('Static style rules')

    await act(async () => button('Lint').click())
    expect(container!.textContent).toContain('Static style rules')
  })

  it('switches preview when inspecting another option and displays notes', async () => {
    const { button } = await mount({
      toolUseId: 'auq-preview',
      result: '"Layout?"="Compact"',
      params: {
        questions: [{
          question: 'Layout?',
          header: 'Layout',
          multiSelect: false,
          options: [
            { label: 'Compact', description: 'Dense rows', preview: 'compact preview' },
            { label: 'Relaxed', description: 'Spacious rows', preview: 'relaxed preview' },
          ],
        }],
        answers: { 'Layout?': 'Compact' },
        annotations: { 'Layout?': { preview: 'compact preview', notes: 'Keep header sticky' } },
        previewFormat: 'markdown',
      },
    })

    expect(container!.querySelector('[data-preview]')?.textContent).toBe('compact preview')
    expect(container!.textContent).toContain('Keep header sticky')

    await act(async () => button('Relaxed').click())
    expect(container!.querySelector('[data-preview]')?.textContent).toBe('relaxed preview')
    expect(container!.textContent).toContain('Spacious rows')
  })

  it('renders custom Other answers and dismissed cards persistently', async () => {
    await mount({
      toolUseId: 'auq-other',
      result: '"Region?"="ap-northeast-1"',
      params: {
        questions: [{
          question: 'Region?',
          header: 'Region',
          multiSelect: false,
          options: [{ label: 'us-east-1', description: 'US East' }, { label: 'eu-west-1', description: 'EU West' }],
        }],
        answers: { 'Region?': 'ap-northeast-1' },
      },
    })
    expect(container!.textContent).toContain('chat.askUser.otherLabel')
    expect(container!.textContent).toContain('ap-northeast-1')

    await act(async () => root?.unmount())
    container?.remove()

    const { button } = await mount({
      toolUseId: 'auq-dismissed',
      isDenied: true,
      result: 'User dismissed the question',
      params: {
        questions: [{
          question: 'Continue?',
          header: 'Continue',
          multiSelect: false,
          options: [
            { label: 'Yes', description: 'Run migration now' },
            { label: 'No', description: 'Abort migration' },
          ],
        }],
      },
    })
    expect(container!.querySelector('[data-ask-user-question-result="auq-dismissed"]')).not.toBeNull()
    expect(container!.textContent).toContain('chat.toolBlock.dismissed')
    await act(async () => button('Yes').click())
    expect(container!.textContent).toContain('Run migration now')
  })

  it('degrades to a single-line compact row when allowExpand is false or streaming', async () => {
    await mount({
      allowExpand: false,
      result: '"Continue?"="Yes"',
      params: { questions: [{ question: 'Continue?', header: 'Continue', multiSelect: false, options: [] }] },
    })
    expect(container!.querySelector('[data-ask-user-question-result]')).toBeNull()
    expect(container!.textContent).toContain('Asked 1 question')

    await act(async () => root?.unmount())
    container?.remove()

    await mount({ isStreaming: true, elapsedSeconds: 3 })
    expect(container!.querySelector('[data-ask-user-question-result]')).toBeNull()
    expect(container!.textContent).toContain('Asking questions…')
    expect(container!.textContent).toContain('3s')
  })

  it('renders stripped/legacy Q&A pairs as a persistent card', async () => {
    const { button } = await mount({
      toolUseId: 'auq-mobile',
      result: '"Which DB?"="Postgres" "Which cache?"="Redis"',
      params: { questions: [{}, {}] },
    })
    expect(container!.querySelector('[data-ask-user-question-result="auq-mobile"]')).not.toBeNull()
    expect(container!.textContent).toContain('Which DB?')
    expect(container!.textContent).toContain('Postgres')
    await act(async () => button('Q2').click())
    expect(container!.textContent).toContain('Which cache?')
    expect(container!.textContent).toContain('Redis')
  })

  it('hides redundant single-question headers while preserving distinct short summaries', async () => {
    await mount({
      toolUseId: 'auq-redundant-ellipsis',
      result: '"dsh UI 插件试点（PR #1–#3）已实测通过，接下来你想怎么继续？"="继续推进"',
      params: {
        questions: [{
          question: 'dsh UI 插件试点（PR #1–#3）已实测通过，接下来你想怎么继续？',
          header: 'dsh UI 插件试点（PR #1–#3）已实测…',
          multiSelect: false,
          options: [{ label: '继续推进', description: '' }],
        }],
        answers: { 'dsh UI 插件试点（PR #1–#3）已实测通过，接下来你想怎么继续？': '继续推进' },
      },
    })
    expect(container!.textContent).not.toContain('dsh UI 插件试点（PR #1–#3）已实测…')
    expect(container!.textContent).toContain('dsh UI 插件试点（PR #1–#3）已实测通过，接下来你想怎么继续？')

    await act(async () => root?.unmount())
    container?.remove()

    await mount({
      toolUseId: 'auq-redundant-exact',
      result: '"Which database?"="Postgres"',
      params: {
        questions: [{
          question: 'Which database?',
          header: 'Which database?',
          multiSelect: false,
          options: [{ label: 'Postgres', description: '' }],
        }],
        answers: { 'Which database?': 'Postgres' },
      },
    })
    const spansExact = [...container!.querySelectorAll('span')].map((el) => el.textContent)
    expect(spansExact).not.toContain('Which database?')

    await act(async () => root?.unmount())
    container?.remove()

    await mount({
      toolUseId: 'auq-short-summary',
      result: '"Which pricing layout do you prefer?"="Three-column"',
      params: {
        questions: [{
          question: 'Which pricing layout do you prefer?',
          header: 'Pricing layout',
          multiSelect: false,
          options: [{ label: 'Three-column', description: '' }],
        }],
        answers: { 'Which pricing layout do you prefer?': 'Three-column' },
      },
    })
    expect(container!.textContent).toContain('Pricing layout')
    expect(container!.textContent).toContain('Which pricing layout do you prefer?')
  })
})
