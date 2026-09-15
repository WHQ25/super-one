# Mobile commands and tests

The root scoped-test rule applies: use targeted files unless a full suite is requested.

## Commands

```bash
bun --filter @superone/chat-view build   # first: emits the chat + terminal documents
bun run dev:mobile                       # Expo dev-client Metro
bun run rebuild:mobile:ios               # prebuild + UTF-8 locale + expo run
bun --filter @superone/mobile typecheck
bun --filter @superone/mobile test              # vitest (state) + jest (components)
bun --filter @superone/mobile test:components   # jest only
```

**Two test runners, on purpose.** `*.test.ts` (pure state modules) runs on
**vitest**; `*.test.tsx` (React Native components) runs on **jest-expo**
(`jest.config.js`). This is not indecision — vitest cannot load React Native.
RN's `index.js` reaches its internals through lazy `require()` calls that escape
Vite's ESM pipeline and arrive at Node as unparsable Flow source; no combination
of `ssr.noExternal`, `server.deps.inline` or a babel plugin intercepts them.
jest-expo reuses the transform Metro already applies. What it costs to use:

- **`render` is async** in React Native Testing Library 14 — React 19 renders
  concurrently and nothing is committed when the call returns. `await` it, or
  every query fails with `render function has not been called`.
- Mount through `renderWithTheme` (`src/test-render.tsx`); `useMobileTheme`
  throws outside its provider.
- **A tree holding `useSyncExternalStore` swallows a bare `fireEvent`.** React 19
  defers the discrete update, and RNTL's implicit synchronous act around
  `fireEvent` never flushes the follow-up pass — the component simply stays in
  its old state and every query below the press fails as though the handler were
  never wired. Wrap it: `await act(async () => { fireEvent.press(el) })`. This
  reaches further than it looks, because `useIconMotion` (the Reduce Motion gate
  behind `SpinningIcon` and every pulsing label) is one of those stores.
  Each press gets its own settled scope, so a test can cover a multi-step interaction.
- **A nested `<Text>` is one text node to RNTL.** `#3 Ship it` rendered as a muted
  `<Text>#3 </Text>` inside the sentence composes to `"#3 Ship it"`, so
  `getByText('Ship it')` finds nothing. Query the composed string.
- Settle each interaction before pressing, rerendering, or unmounting again.
  Do not impose a one-press-per-test rule: multi-step flows are valid when their
  async `act` scopes are awaited. For conditional mount checks, rerender a wrapper
  that controls whether the child is mounted.
- `renderWithTheme`'s `rerender` re-wraps the provider. RNTL's own replaces the
  whole tree, so a bare `result.rerender` remounts into a tree with no
  `MobileThemeProvider` and every themed component throws.
- **A suite that cannot load reports as missing tests, not failing ones.**
  `jest` prints `Test suite failed to run` and the total simply drops — six
  tests once "disappeared" because a hook had grown an
  `import { mobileKv } from '../storage'`, and `storage.ts` takes a *value*
  from `@superone/relay-client`, dragging `@noble/ciphers` (pure ESM) into a
  CommonJS parse. Fix it by not reaching for the encrypted store from a hook —
  inject it, as `ComposerSuggestionSource.iconStore` does — rather than by
  widening `transformIgnorePatterns`. Check the total, not just the exit code.
- `jest.config.js` pins `^react$` to this workspace's copy. Bun leaves a nested
  `apps/mobile/node_modules/react` (pinned 19.1.0) beside the hoisted root one,
  and without the mapping `react-reconciler` and the components under test load
  different React instances — every hook then sees a null dispatcher.

If a test runner is blocked by the active sandbox, inspect the reported operation
and request only the access it needs. Neither runner requires blanket escalation.

`packages/chat-view/src/generated-host-html.ts` and `generated-terminal-html.ts` are
**build artifacts** (6 MB) — gitignored, never committed, produced by the chat-view build
above. Mobile `dev` / `test` / `typecheck` must run that build first (the root script and mobile `pre*` hooks handle this); a missing artifact must fail with a
readable error, not deep inside Metro.


## Maestro

Two things about running `test:ui` that cost real time to learn. **Maestro matches
a whole accessibility label, not a substring**, and a suggestion row composes its
name, argument hint and description into one element — so the assertion is
`"/clear, Clear the conversation and start over"`, never `"/clear"`. And **do not
edit source while a suite is running**: Metro's watcher fast-refreshes the app
mid-flow, which resets `native-preview-ready` and fails unrelated flows in ways
that read exactly like regressions. Conversely, starting the preview with `CI=1`
disables the watcher, and Maestro then verifies a stale bundle — the edit you are
testing is not in it.
