# Mobile visual catalog

Status: proposed; implementation has not started.
Date: 2026-09-05.
Implementation target: `feat/migrate-to-expo`, currently checked out at
`/Users/wuhangqi25/.worktrees/super-one/tjq6wo-1a6659a`.

## Outcome

Provide a searchable catalog where a reviewer can select any mobile tool or
interaction, change its state, compare it with desktop, and open the same scenario
in an Expo development client without pairing, a running agent, or a relay.

Visual alignment means consistent tokens, information hierarchy, summaries, and
outcome semantics. Native sheets retain mobile layout, touch targets, keyboard
handling, and safe-area behavior; desktop geometry is not a pixel target.

## Verified starting point

- Current `main` does not contain `apps/mobile`; the migration worktree does.
- `packages/chat-view` renders chat in a WebView using React DOM. Its
  `PortableTurnAdapters.tsx` selects presenters and generic fallbacks.
- `apps/mobile/src/sheets.tsx` exports `PermissionSheet`, `QuestionSheet`, and
  `PlanSheet`. Their props already separate presentation from remote responses.
- Permission presentation handles nine explicit `requestKind` values plus the
  ordinary tool-permission default. The default must also have coverage.
- `packages/chat-view/e2e/fixtures/tool-family-recordings.ts` already supplies
  representative messages. `e2e/chat-view.spec.ts` exercises the built document
  with a mock WebView bridge, including offline execution.
- Desktop `.storybook/main.ts` collects desktop and shared package stories, but
  currently has no mobile/chat-view collection. Its global CSS and IPC decorators
  must not leak into a mobile document.

## Recommended surfaces

### 1. Desktop Storybook: browse and compare

Add `Mobile/Tools`, `Mobile/Permissions`, `Mobile/Questions`, `Mobile/Plans`,
and `Mobile/Scenarios` catalog entries to the existing Storybook experience.

For tools, show the desktop renderer and the actual mobile chat document side by
side, driven by the same scenario data. Host mobile in an isolated iframe with
its own production CSS, fonts, theme, locale, viewport, and bridge adapter.
Render through the real mobile dispatcher, not just a hand-picked presenter:
this exposes missing routing, hidden output, and unexpected generic fallbacks.
Keep presenter-only stories available for focused component work.

For native sheets, show the desktop reference, scenario description, native
preview launch action, and optionally the latest explicitly captured device
image with its platform/theme/locale and timestamp. Do not substitute a DOM
recreation for the native implementation. Browser-only RN rendering can be
evaluated later if reviewers need it; it is not required for the first delivery.

Controls: theme, locale, harness, viewport preset, outcome, expanded state,
and isolated component versus chat context. Each scenario gets a stable link.
Provide an overview grid for scanning all tools and a focused comparison view.
Use shared fixture IDs across desktop, native, and screenshot outputs.

### 2. Expo on-device Storybook: inspect native behavior

Use `@storybook/react-native` through a development-only entry point. Reuse the
actual theme provider, safe-area provider, sheet components, composer, and chat
WebView wrapper. Select versions compatible with this branch's Expo 54, RN 0.81,
and installed Storybook before installing; do not upgrade the app as a side effect.

The native catalog includes both isolated sheets and a full chat scene with the
WebView, native input, and overlay together. This is the acceptance surface for
iOS/Android fonts, modal placement, scrolling, keyboard avoidance, and safe areas.

Opening a story must not initialize storage, pairing, transport, or an agent.
Callbacks update local scenario state and a small action log. Reset reopens the
original scenario. Native requests use deterministic mock success/error results;
unsupported requests remain visibly unsupported.

Provide a development-only scenario link such as
`superone://ui-lab?scenario=permissions/bash/default`. Validate the ID against the
catalog and ignore it in production. Exact routing is chosen to fit the actual
React Navigation setup, rather than assuming expo-router from older planning docs.

## One scenario contract

Create a small framework-neutral fixture workspace, provisionally
`packages/chat-fixtures`. It contains typed data only: stable IDs, category,
tool names/request kind, messages or request payload, applicable states,
expected mobile rendering mode, desktop story reference, and coverage notes.
No React, React Native, desktop stores, IPC, or Node-only imports.

Move reusable existing recordings here without changing their semantics.
Desktop stories, mobile stories, and browser tests consume the same data with
separate rendering adapters. Use static local images and deterministic IDs,
timestamps, and outputs. Include remote-stripped inputs and summaries, not only
the rich desktop payloads.

Catalog status distinguishes dedicated presenter, generic fallback, output owned
by another surface, unsupported capability, and missing scenario. Generic fallback
must remain visible as a migration gap when a designed row is expected.

Build the coverage manifest from actual tool dispatch paths, shared tool metadata,
permission types, and desktop stories. Every tool maps to a scenario or an explicit
reason it has no row. Do not equate one story per family with every tool covered.
Add a cheap coverage check for new request kinds and tool entries drifting out of
the manifest; avoid refactoring the production dispatcher solely for discovery.

## Coverage matrix

| Area | Required scenarios |
| --- | --- |
| File/command/search | Read, Write, Edit/diff, command output, file/search results, long paths, remote-stripped input |
| SuperOne tools | Browser, computer/device, sessions/archive, collaboration/agents, config, automation, media, reports, and every remaining routed tool |
| Generic/owned output | Third-party MCP, unknown tool, native widget gallery, hidden tool with visible owning output, unsupported content |
| Tool states | Running, complete, error, denied; expanded/collapsed and nested non-expandable where supported |
| Ordinary permission | Command, file edit, network/sandbox, blocked path, suggestions, allow-once/always policy |
| Explicit permission kinds | `mcp_elicitation`, `video_gen_confirm`, `config_confirm`, `session_agents_confirm`, `computer_use_grant`, `session_cleanup_confirm`, `automation_confirm`, `webmcp_trust_confirm`, `device_control_confirm` |
| Questions | Single/multiple choice, multiple questions, custom answer, preview, notes, incomplete/valid submission |
| Plans | Short/long plan, requested permissions, approve, approve-and-continue, reject with feedback |
| Composite scenes | Tool awaits approval → sheet → response → resolved row; question submission; plan review; input with keyboard and overlay |

Use light/dark, English/Chinese, representative narrow/normal phone widths, and
tablet split layout. Start with a canonical configuration per scenario and selected
stress combinations; do not create the full Cartesian product of controls.
Unsupported locale behavior should be recorded as a gap, not hidden by fixture copy.

## Delivery sequence

1. **Vertical slice:** fixture contract, desktop/mobile tool comparison, native
   Storybook entry, one permission, one question, and one combined chat scene.
   Verify independence from pairing and correct WebView CSS/bridge behavior.
2. **Complete catalog:** enumerate tool mappings and all permission kinds; migrate
   recordings, add state/edge-case fixtures, filters, stable links, and action reset.
3. **Review loop:** take representative browser and simulator captures, add selected
   screenshot regressions to existing Playwright infrastructure, and document native
   capture steps. Mark pending native checks explicitly.

Proposed commands, not currently implemented:

- `bun run storybook`: existing desktop catalog plus mobile comparison entries.
- `bun run storybook:mobile`: Expo native catalog in the development client.
- `bun run test:mobile-visual`: selected browser screenshot and coverage checks.

The browser mobile document should use a dev server for fast edits, while a build
verification exercises the actual embedded HTML asset. Exclude Storybook imports,
fixtures, and development links from production entry graphs and verify the export.

## Acceptance

- Every enumerated mobile tool and permission kind is discoverable, with gaps explicit.
- Running/error/denied cases show actual production labels and routing.
- Changing theme/locale/viewport reaches the WebView and native providers consistently.
- Reviewers can compare matching desktop/mobile scenarios and reset interactions.
- Allow/deny/submit are inspectable local actions and never issue remote effects.
- One physical/simulator iOS and Android pass checks sheet dismissal, long content,
  keyboard, safe areas, and tablet layout where available. Browser screenshots alone
  cannot establish native parity.
- Run only scoped package checks; this plan does not require a repository-wide suite.

## External references

- [Storybook: React Native Web versus on-device](https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite)
- [React Native Storybook](https://github.com/storybookjs/react-native)
- [In-app setup](https://storybookjs.github.io/react-native/docs/intro/getting-started/manual-setup/)

Official documentation distinguishes browser compatibility from full-fidelity native
preview. That distinction is why this hybrid app needs both preview surfaces.
