import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AttachmentChipPresenter } from './AttachmentChip'
import { DEFAULT_USER_BUBBLE_PORTS, UserBubblePortsProvider } from './user-bubble-ports'

/** Rendered text, ignoring markup: a chip's label is split around its icon. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, '')

const chip = (att: { name: string; mimeType: string; base64: string }, document?: boolean) =>
  renderToStaticMarkup(createElement(AttachmentChipPresenter, { att, document }))

describe('AttachmentChipPresenter', () => {
  it('renders an image attachment as a thumbnail chip carrying its filename', () => {
    const html = chip({ name: 'cat.png', mimeType: 'image/png', base64: 'AAA' })

    expect(html).toContain('data-mention-kind="attachment"')
    expect(textOf(html)).toContain('cat.png')
    expect(html).toContain('src="data:image/png;base64,AAA"')
  })

  it('renders a pdf attachment as an icon chip with its title and no thumbnail image', () => {
    const html = chip({ name: 'spec.pdf', mimeType: 'application/pdf', base64: 'AAA' })

    expect(textOf(html)).toContain('spec.pdf')
    expect(html).not.toContain('<img')
  })

  it('treats a document block as a document even when its bytes are gone', () => {
    const html = chip({ name: 'spec.pdf', mimeType: '', base64: '' }, true)

    expect(textOf(html)).toContain('spec.pdf')
    expect(html).not.toContain('<img')
  })

  it('paints a host-resolved file when the transcript carried no bytes', () => {
    const html = renderToStaticMarkup(createElement(
      UserBubblePortsProvider,
      { value: { ...DEFAULT_USER_BUBBLE_PORTS, localAttachmentSrc: () => 'local-file:///sync/s1/attachment/shot.png' } },
      createElement(AttachmentChipPresenter, { att: { name: 'image.png', mimeType: 'image/png', base64: '', originalPath: '/sync/s1/attachment/shot.png' } }),
    ))
    expect(html).toContain('src="local-file:///sync/s1/attachment/shot.png"')
    expect(textOf(html)).toContain('image.png')
  })

  it('shows an icon for a picture that came without bytes', () => {
    const html = chip({ name: 'IMG_1.jpg', mimeType: 'image/jpeg', base64: '' })

    expect(textOf(html)).toContain('IMG_1.jpg')
    expect(html).not.toContain('<img')
    expect(html).toContain('lucide-image')
  })

  it('renders an edit icon button in the hover preview actions for composer image attachments', () => {
    const html = renderToStaticMarkup(createElement(
      UserBubblePortsProvider,
      {
        value: {
          ...DEFAULT_USER_BUBBLE_PORTS,
          ChipCard: ({ actions, children }) => createElement('div', null, actions, children),
        },
      },
      createElement(AttachmentChipPresenter, {
        att: { name: 'draft.png', mimeType: 'image/png', base64: 'AAA' },
        onReplaceAttachment: () => {},
      }),
    ))

    expect(html).toContain('data-testid="attachment-chip-edit-button"')
  })
})

