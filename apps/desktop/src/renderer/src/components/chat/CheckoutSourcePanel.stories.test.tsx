/** @vitest-environment jsdom */
import type { ComponentType } from 'react'
import { act, render } from '@testing-library/react'
import { beforeAll, expect, it } from 'vitest'
import i18n from 'i18next'

const HEAD = 'd'.repeat(40)

let panel: typeof import('./CheckoutSourcePanel.stories')
let menu: typeof import('./GitBranchMenu.stories')
beforeAll(async () => {
  panel = await import('./CheckoutSourcePanel.stories')
  menu = await import('./GitBranchMenu.stories')
  // Storybook's IPC mocks do not reach Vitest's window.app.
  Object.assign(window.app, {
    listCheckoutSourceBranches: async () => ({
      ok: true,
      branches: [
        { ref: 'a', title: 'feat/a', head: HEAD, localName: 'feat/a', relation: 'behind', behind: 2, checkedOut: true, dirty: { files: 1, insertions: 1, deletions: 0 } },
        { ref: 'b', title: '#7 Fix', head: HEAD, localName: 'pr/7-fix', relation: 'diverged', fork: true, detail: 'someone', updatedAt: Date.now() - 3_600_000 },
      ],
    }),
    checkoutFromSource: async () => ({ ok: true, branch: 'feat/a', head: HEAD, status: 'updated', snapshot: false }),
    cancelCheckout: async () => {},
    onCheckoutProgress: () => () => {},
  })
}, 60_000)

it.each(['en', 'zh'])('renders the checkout-source stories with resolved copy in %s', async (locale) => {
  const previous = i18n.language
  await i18n.changeLanguage(locale)
  try {
    for (const mod of [panel, menu]) {
      const { default: meta, ...named } = mod as unknown as Record<string, { args?: object; beforeEach?: () => void; component?: ComponentType<object> }>
      const Component = meta!.component!
      for (const story of Object.values(named)) {
        let container!: HTMLElement
        let unmount!: () => void
        await act(async () => {
          ;({ container, unmount } = render(<Component {...meta!.args} {...story.args} />))
        })
        // An unresolved key renders as its dotted path.
        expect(container.textContent).not.toMatch(/chat\.(git|worktree)\./)
        unmount()
      }
    }
  } finally {
    await i18n.changeLanguage(previous)
  }
})
