import { describe, expect, it } from 'vitest'
import { isDrawableModTree } from './validate'

const press = { plugin: 'p', handle: 1 }

describe('isDrawableModTree', () => {
  it('draws well-formed elements', () => {
    expect(isDrawableModTree({
      type: 'Box',
      props: { flexDirection: 'column' },
      children: [
        'text',
        { type: 'Button', props: { key: 'b', label: 'Go', hotkey: 'g' }, press },
        { type: 'Select', props: { key: 's', options: [{ value: 'a', label: 'A' }] }, press },
        { type: 'Code', props: { source: '+a', format: 'diff' } },
        { type: 'Markdown', props: { text: '**x**' } },
        { type: 'Svg', props: { source: '<svg/>', alt: '' } },
        { type: 'Client', props: { key: 'c', module: 'm.tsx', width: '50%' }, client: { plugin: 'p' } },
        { type: 'engine', ref: 0 },
      ],
    })).toBe(true)
  })

  it('refuses props the renderer would throw on', () => {
    const bad = [
      { type: 'Select', props: { key: 'k', options: 5 }, press },
      { type: 'Select', props: { key: 'k', options: [{ value: '' }] }, press },
      { type: 'Button', props: { key: 'k', label: { x: 1 } }, press },
      { type: 'Button', props: { key: 'k', label: 'x', hotkey: ['a'] }, press },
      { type: 'Button', props: { key: 'k', label: 'x' }, press: { handle: 1 } },
      { type: 'Code', props: { source: 7 } },
      { type: 'Code' },
      { type: 'Markdown', props: { text: { a: 1 } } },
      { type: 'Svg', props: { alt: '' } },
      { type: 'Client', props: { key: 'c', module: 'm' } },
      { type: 'Box', props: { width: { a: 1 } } },
      { type: 'Text', hover: [1] },
      { type: 'Link', props: { href: 1 } },
      { type: 'toString' },
    ]
    for (const node of bad) expect(isDrawableModTree({ type: 'Box', children: [node] }), JSON.stringify(node)).toBe(false)
  })
})
