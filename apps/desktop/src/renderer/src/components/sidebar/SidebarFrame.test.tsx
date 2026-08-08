/** @vitest-environment jsdom */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SidebarFrame } from './SidebarFrame'

describe('SidebarFrame', () => {
  it('keeps the inner sidebar width while the clipping frame opens and closes', () => {
    const { container, rerender } = render(
      <SidebarFrame open width={240}>
        <span>Sidebar content</span>
      </SidebarFrame>,
    )

    const outer = container.querySelector<HTMLElement>('[data-sidebar-outer]')
    const inner = container.querySelector<HTMLElement>('[data-sidebar-inner]')
    expect(outer).not.toBeNull()
    expect(inner).not.toBeNull()
    if (!outer || !inner) return
    expect(outer).toHaveClass('overflow-hidden')
    expect(outer).toHaveStyle({ width: '240px' })
    expect(inner).toHaveStyle({ width: '240px' })

    rerender(
      <SidebarFrame open={false} width={240}>
        <span>Sidebar content</span>
      </SidebarFrame>,
    )

    expect(outer).toHaveStyle({ width: '0px' })
    expect(inner).toHaveStyle({ width: '240px' })
  })
})
