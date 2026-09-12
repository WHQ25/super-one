import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ImageAttachment } from '@superone/shared/agent-types'
import { attachmentForBlock, PortableAttachmentChip } from './PortableAttachmentChip'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4FmcDAAN+AXFyCQ1WAAAAAElFTkSuQmCC'
const photo: ImageAttachment = { id: 'a1', name: 'IMG_0005.jpg', mimeType: 'image/png', base64: PNG }

describe('attachment chips in the user bubble', () => {
  it('resolves a block to its attachment by id, or by name for older messages', () => {
    const renamed: ImageAttachment = { ...photo, name: 'other.jpg' }
    expect(attachmentForBlock({ attachments: [renamed] }, { type: 'image', name: 'IMG_0005.jpg', id: 'a1' })).toBe(renamed)
    expect(attachmentForBlock({ attachments: [photo] }, { type: 'image', name: 'IMG_0005.jpg' })).toBe(photo)
    expect(attachmentForBlock({ attachments: [photo] }, { type: 'image', name: 'missing.jpg', id: 'nope' })).toBeUndefined()
    expect(attachmentForBlock({}, { type: 'image', name: 'IMG_0005.jpg' })).toBeUndefined()
  })

  it('paints a tappable thumbnail when the bytes are there', () => {
    const html = renderToStaticMarkup(createElement(PortableAttachmentChip, {
      block: { type: 'image', name: 'IMG_0005.jpg', id: 'a1' }, attachment: photo,
    }))
    expect(html).toContain(`src="data:image/png;base64,${PNG}"`)
    expect(html).toContain('aria-label="Preview IMG_0005.jpg"')
    expect(html).toContain('data-attachment-chip="image"')
  })

  it('falls back to an icon when the picture came without bytes', () => {
    const html = renderToStaticMarkup(createElement(PortableAttachmentChip, {
      block: { type: 'image', name: 'IMG_0005.jpg', id: 'a1' }, attachment: { ...photo, base64: '' },
    }))
    expect(html).not.toContain('<img')
    expect(html).toContain('IMG_0005.jpg')
  })

  it('never tries to draw a PDF as a bitmap', () => {
    const html = renderToStaticMarkup(createElement(PortableAttachmentChip, {
      block: { type: 'document', name: 'report.pdf', id: 'p1' },
      attachment: { id: 'p1', name: 'report.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' },
    }))
    expect(html).not.toContain('<img')
    expect(html).toContain('data-attachment-chip="document"')
    expect(html).toContain('report.pdf')
  })
})
