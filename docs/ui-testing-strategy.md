# UI Component Testing Strategy

## Problem

Current tests (Vitest + jsdom) cover logic well but cannot verify **layout behavior**. jsdom has no CSS layout engine — `scrollWidth`, `clientWidth`, `offsetWidth` all return 0. This means layout-dependent UI logic is untestable:

- `useLayoutEffect` measuring overflow (`scrollWidth > clientWidth`) to switch inline → block
- Single-line summary truncation with `truncate` class
- `@container` query breakpoints at 512px / 672px
- Collapsible group header overflow detection

These are real bugs that have occurred in ToolBlock, SubagentBlock, and ToolGroup components.

## Two-Layer Strategy

```
Vitest + jsdom (fast, high volume)     → Pure logic, conditional rendering, data transforms
Playwright CT (slower, targeted)       → Layout assertions (overflow, truncation, inline vs block)
```

| Metric | Vitest + jsdom | Playwright CT |
|---|---|---|
| Cold start | ~1-2s | ~3-5s (browser + Vite dev server) |
| Per test | ~5-20ms | ~100-300ms |
| 20 tests | ~1-2s | ~5-10s |
| Parallelism | Multi-thread | Multi-worker (shared browser instance) |

Playwright CT is ~10-20x slower per test, but with only 10-20 layout tests the absolute time is negligible in CI.

## Layer 1: Vitest + jsdom

**What to test**: Conditional rendering, props-driven UI, event handlers, data processing — anything that doesn't depend on real CSS layout.

### Good Candidates

- ToolBlock: denied state renders ban icon + denied text
- ToolBlock: streaming state shows spinner, complete state shows check
- ToolGroup: `generateSummary()` produces correct text for tool combinations
- SubagentBlock: token display formats correctly (`formatTokens`, `formatElapsed`)
- SubagentBlock: child blocks render inside expanded state

### Example

```typescript
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'

it('ToolBlock shows denied feedback when result starts with [denied]', () => {
  render(
    <ToolBlock
      toolName="Edit"
      input='{"file_path":"foo.ts","old_string":"a","new_string":"b"}'
      status="complete"
      result="[denied] Not allowed"
    />
  )
  expect(screen.getByText('Denied')).toBeInTheDocument()
  expect(screen.getByText('Not allowed')).toBeInTheDocument()
})
```

## Layer 2: Playwright Component Testing

**What to test**: Any behavior that depends on real CSS layout — overflow detection, truncation, responsive breakpoints, `useLayoutEffect` measurement.

### Good Candidates

- Feedback text overflow → inline vs block switch
- ToolGroup summary line truncation when text exceeds container width
- SubagentBlock description truncation in collapsed header
- Bash terminal output line wrapping at container boundary
- Container query breakpoints changing chat layout

### Example

```typescript
import { test, expect } from '@playwright/experimental-ct-react'
import { ToolBlock } from './ToolBlock'

test('long denied feedback renders as block, not inline', async ({ mount }) => {
  const component = await mount(
    <ToolBlock
      toolName="Edit"
      input='{"file_path":"foo.ts","old_string":"a","new_string":"b"}'
      status="complete"
      result="[denied] This file is protected and requires admin approval to modify before any changes can be applied"
    />,
    { hooksConfig: { viewport: { width: 400 } } }
  )

  const feedback = component.getByText(/This file is protected/)
  // Block-level feedback should NOT have truncate class
  await expect(feedback).not.toHaveClass(/truncate/)
  // Should be a div (block), not a span (inline)
  const tagName = await feedback.evaluate(el => el.tagName.toLowerCase())
  expect(tagName).toBe('div')
})

test('short denied feedback stays inline', async ({ mount }) => {
  const component = await mount(
    <ToolBlock
      toolName="Edit"
      input='{"file_path":"foo.ts","old_string":"a","new_string":"b"}'
      status="complete"
      result="[denied] Not allowed"
    />
  )

  const feedback = component.getByText('Not allowed')
  const tagName = await feedback.evaluate(el => el.tagName.toLowerCase())
  expect(tagName).toBe('span')
})
```

## Priority Scenarios for Playwright CT

### P0 — Active Layout Bugs

1. **Feedback inline vs block** — `useLayoutEffect` measures `scrollWidth > clientWidth` on feedback span, switches to block `<div>` when overflow detected
2. **ToolGroup summary truncation** — collapsed header must truncate tool summary without breaking layout; verify `scrollWidth > clientWidth` triggers ellipsis
3. **Single-line ToolBlock overflow** — summary line (icon + tool name + file path + feedback) must not wrap to second line in narrow container

### P1 — Responsive Layout

4. **SubagentBlock collapsed header** — description + token count + elapsed time must fit single line; excess truncates
5. **Chat panel container queries** — layout adapts at `@container` breakpoints (512px, 672px)
6. **Diff view line wrapping** — long code lines in Edit/Write tool result handle overflow correctly

### P2 — Edge Cases

7. **Very long file paths** — ToolBlock with deep nested path (`/a/b/c/d/.../file.ts`) truncates gracefully
8. **RTL/mixed content** — tool output containing mixed LTR/RTL text doesn't break layout
9. **Zero-width container** — components don't crash when rendered in collapsed/hidden panels

## Setup Guide

### 1. Install Dependencies

```bash
bun add -d @playwright/experimental-ct-react @playwright/test
```

### 2. Create Playwright CT Config

Create `playwright-ct.config.ts` in project root:

```typescript
import { defineConfig, devices } from '@playwright/experimental-ct-react'
import { resolve } from 'path'

export default defineConfig({
  testDir: 'src/renderer/src/components',
  testMatch: '**/*.ct.tsx',
  use: {
    ctPort: 3200,
    ctViteConfig: {
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src/renderer/src'),
        },
      },
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

### 3. Create Playwright CT Entry

Create `playwright/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Testing</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./index.tsx"></script>
</body>
</html>
```

Create `playwright/index.tsx`:

```typescript
import '../src/renderer/src/styles/index.css'
```

### 4. Mock Electron APIs

Components use `window.agent`, `window.app`, and Zustand stores. Create a test wrapper:

```typescript
// playwright/test-wrapper.tsx
import { beforeMount } from '@playwright/experimental-ct-react/hooks'

beforeMount(async () => {
  // Stub window.agent and window.app
  window.agent = new Proxy({}, { get: () => () => undefined }) as any
  window.app = new Proxy({}, { get: () => () => undefined }) as any
})
```

Register in `playwright-ct.config.ts`:

```typescript
use: {
  ctViteConfig: {
    // ...alias config
  },
  // Register the hooks file
},
```

### 5. Handle Zustand Stores

Components read from Zustand stores (e.g., `useActiveSession`, `useAppStore`). Two options:

**Option A — Mock at module level** (simpler, recommended for most cases):

```typescript
// In test file
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Pre-populate store state before component mounts
  })
})
```

**Option B — Wrapper component** (more flexible):

```typescript
function TestWrapper({ children, sessionState }) {
  // Initialize stores with test data
  return <>{children}</>
}
```

### 6. Add Script to package.json

```json
{
  "scripts": {
    "test:ct": "playwright test -c playwright-ct.config.ts"
  }
}
```

### 7. File Naming Convention

```
src/renderer/src/components/chat/
├── ToolBlock.tsx           — Component
├── ToolBlock.test.tsx      — Vitest (logic tests)
├── ToolBlock.ct.tsx        — Playwright CT (layout tests)
```

Use `.ct.tsx` suffix for Playwright component tests to distinguish from Vitest `.test.tsx` files.

## Decision Record

- **Why not visual regression (screenshot diff)?** — Baseline maintenance cost is high; font rendering varies across OS/CI. DOM assertions are more stable and expressive.
- **Why not Storybook?** — Additional toolchain overhead; decoupling Electron IPC and Zustand stores for Storybook is significant effort for marginal benefit over Playwright CT.
- **Why not Electron E2E?** — Full app startup is slow (~5-10s) and tests become brittle. Component-level isolation is sufficient for layout verification.
- **Why Playwright CT over Cypress CT?** — Playwright has better Vite integration, faster execution, and the project already uses a Vite-based build (electron-vite).
