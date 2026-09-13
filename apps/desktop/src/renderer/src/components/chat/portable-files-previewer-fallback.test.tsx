/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PortableToolRow } from '@superone/chat-view/PortableToolRow'

/**
 * The phone dispatches native `widget_show` results by type, never by "it parsed".
 * `PortableNativeGallery` draws images or videos and would show a previewer
 * payload as an empty video strip, so until the phone has its own card the
 * previewer keeps the ordinary tool row.
 */
const gallery = JSON.stringify({
  kind: 'native',
  nativeType: 'image-gallery',
  title: 'g',
  images: [{ id: 'g-0', type: 'image_generation', status: 'completed', savedPath: '/tmp/a.png' }],
})
const previewer = JSON.stringify({
  kind: 'native',
  nativeType: 'files-previewer',
  title: 'changed_files',
  root: '/repo',
  files: [{ path: 'a.png', absolutePath: '/repo/a.png', name: 'a.png', kind: 'image', size: 1 }],
})

function renderRow(result: string) {
  return render(
    <PortableToolRow toolName="mcp__superone__widget_show" toolUseId="w-1" input="{}" status="complete" result={result} />,
  )
}

describe('native widget_show on the phone', () => {
  it('mounts the gallery for a gallery payload', () => {
    const { container } = renderRow(gallery)
    expect(container.querySelector('[data-native-widget="image-gallery"]')).not.toBeNull()
  })

  it('keeps the ordinary tool row for a files-previewer payload instead of an empty gallery', () => {
    const { container } = renderRow(previewer)
    expect(container.querySelector('[data-native-widget]')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('widget show')
  })
})
