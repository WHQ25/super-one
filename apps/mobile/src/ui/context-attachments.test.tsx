import { expect, jest, test } from '@jest/globals'
import { fireEvent, screen } from '@testing-library/react-native'
import { renderWithTheme } from '../test-render'
import { ContextAttachments, ContextAttachmentPreview } from './context-attachments'
import { contextSvgXml } from './context-thumbnail'

test('the generic native attachment removes only the selected item and exposes failure/progress', async () => {
  const remove = jest.fn()
  const result = await renderWithTheme(<ContextAttachments items={[{ id: 'one', title: 'Dial' }, { id: 'two', title: 'Gear' }]} onRemove={remove} />)
  await fireEvent.press(screen.getByLabelText('Remove Attachment: Gear'))
  expect(remove).toHaveBeenCalledWith('two')
  await result.rerender(<ContextAttachments items={[{ id: 'one', title: 'Dial' }]} onRemove={remove} removing={['one']} error="Host disconnected" />)
  expect(screen.getByLabelText('Remove Attachment: Dial').props.accessibilityState.disabled).toBe(true)
  expect(screen.getByText('Host disconnected')).toBeTruthy()
})

test('the preview paints text as text and rejects host-local image URIs', async () => {
  await renderWithTheme(<ContextAttachmentPreview item={{ id: 'bg', title: 'CAD context', content: '<script>unsafe()</script>', previewImages: [{ src: 'file:///private.png', alt: 'Private' }, { src: 'https://example.com/dial.png', alt: 'Drawing' }] }} />)
  expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy()
  expect(screen.queryByLabelText('Private')).toBeNull()
  expect(screen.getByLabelText('Drawing')).toBeTruthy()
})

test('empty native context adds no permanent composer strip', async () => {
  await renderWithTheme(<ContextAttachments items={[]} />)
  expect(screen.queryByRole('button')).toBeNull()
})

// Actual Bits & Bolts server icon (assets/icon.svg), not a simplified test drawing.
const bitsAndBoltsIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path
    fill="none"
    stroke="#27272a"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
    d="M9.5 4.75h13L29 16l-6.5 11.25h-13L3 16zM13 10.8h6l3 5.2-3 5.2h-6L10 16z"
  />
</svg>
`

test('the actual Bits & Bolts SVG App icon renders natively, including base64 data', async () => {
  const src = `data:image/svg+xml,${encodeURIComponent(bitsAndBoltsIcon)}`
  await renderWithTheme(<ContextAttachments items={[{ id: 'bg', title: 'CAD context', thumbnail: src }]} />)
  expect(screen.getByTestId('context-thumbnail-svg')).toBeTruthy()
  expect(contextSvgXml(src)).toContain('strokeWidth="3"')
  expect(contextSvgXml(`data:image/svg+xml;base64,${btoa(bitsAndBoltsIcon)}`)).toContain('M9.5 4.75')
})

test('native SVG icons omit scripts, event handlers and all external image/use/paint references', async () => {
  const xml = contextSvgXml(`data:image/svg+xml,${encodeURIComponent('<svg><script>alert(1)</script><image href="https://evil/image"/><image xlink:href="https://evil/other"/><use href="https://evil/icon"/><path onload="unsafe()" fill="url(https://evil/paint)" style="stroke:url(https://evil/stroke);fill:red" d="M0 0"/><use href="#local"/></svg>')}`)
  expect(xml).not.toMatch(/script|image|https:|onload|unsafe/)
  expect(xml).toContain('href="#local"')
  expect(xml).toContain('fill="red"')
})

test('invalid or oversized native SVG icons fall back to the generic attachment icon', async () => {
  expect(contextSvgXml('data:image/svg+xml,%zz')).toBeUndefined()
  expect(contextSvgXml(`data:image/svg+xml,${'a'.repeat(32 * 1024)}`)).toBeUndefined()
  expect(contextSvgXml('data:image/svg+xml,%3Csvg%3E%3C')).toBeUndefined()
  await renderWithTheme(<ContextAttachments items={[{ id: 'bg', title: 'CAD context', thumbnail: 'data:image/svg+xml,%zz' }]} />)
  expect(screen.getByTestId('context-thumbnail-fallback')).toBeTruthy()
})
