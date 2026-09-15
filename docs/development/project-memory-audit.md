# Project memory audit

Reviewed all repository-owned project instruction entrypoints on September 14,
2026, following the [prompt guidance audit](../design/prompt-guidance-audit.md).
The scope is tracked project memory, not user-global instructions or dependency
files. This follow-up changes documentation only.

## Inventory and disposition

| Scope | Files reviewed | Result |
|---|---|---|
| Repository | `AGENTS.md`, `CLAUDE.md` | One canonical short policy; commit detail and package-resolution reference load on demand |
| Desktop | `apps/desktop/{AGENTS,CLAUDE}.md` | Short entrypoint routing architecture, packaging, styling, debugging, tests, devices, and mini-apps |
| Mobile | `apps/mobile/{AGENTS,CLAUDE}.md` | Short entrypoint routing transcript, workspace, composer, files, transport, native builds, and tests |
| CLI | `apps/cli/{AGENTS,CLAUDE}.md` | Current runner/readiness boundaries; lab procedures moved behind a relevant-task link |
| Web | `apps/web/{AGENTS,CLAUDE}.md` | Next.js documentation reads scoped to API/version questions; preserve brand and locale invariants |
| Video | `apps/video/{AGENTS,CLAUDE}.md` | Deterministic rendering remains required; streaming implementation recipe becomes an optional design reference |
| Shared i18n | `packages/shared/src/i18n/{AGENTS,CLAUDE}.md` | Retain English/Chinese key parity; clarify running-action sentence case |

All seven `AGENTS.md` files retain `@CLAUDE.md` plus a fallback instruction for
harnesses that do not expand includes. The fallback now points to a short local
entrypoint, not a mandatory full subsystem manual.

The additional `.claude/skills/vercel-react-best-practices/AGENTS.md` was inspected
for scope: it is a bundled third-party skill reference, not project memory. It
was not rewritten. No tracked Gemini/Cursor/Copilot project instruction entrypoints
were found in the inventory. Personal memory outside this repository is excluded.

## Findings and corrections

- **Context growth:** entrypoints had accumulated release histories, UI bug diaries,
  API maps, and detailed test recipes. The 14 files decreased from 2,167 to 320
  lines (85.2%). Subsystem knowledge remains available in 18 targeted reference
  documents. This measures entrypoint loading size, not total documentation size
  or model performance.
- **CLI production state:** removed “currently simulated” and stage-number claims.
  `apps/cli/src/session/codex-turn-runner.ts` dispatches production runners;
  `harness-runners.ts` makes simulated fallback opt-in. Preserve failure on missing
  production execution support.
- **Mobile navigation:** corrected `expo-router` to React Navigation native stack,
  matching `apps/mobile/package.json` and `src/navigation/mobile-navigator.tsx`.
- **Mobile tests:** removed blanket one-press/remount prohibitions that contradicted
  the awaited-`act` guidance and existing multi-step tests such as
  `src/ui/file-preview.test.tsx`. Preserve async rendering and theme-wrapped rerender.
- **Sandbox:** removed unconditional test-runner escalation claims. Access failures
  are operation- and environment-specific; inspect the failure before escalation.
- **Migration schedules:** removed an old WP-25→29 schedule from the mobile entrypoint.
  Historical plans do not define every subsequent task's implementation order.
- **Video instructions:** removed fragile source line numbers and distinguished the
  proposed token schedule from the character-interpolation baseline still present
  in `packages/desktop-mocks/src/desktop/chat-mock.tsx`.
- **Desktop maintenance:** removed Flutter-client method references, routed Codex
  changes to the relevant backend/skill, and distinguished host-tool admission from
  executor authorization. Log paths now follow variant identity instead of a fixed
  packaged app name.
- **Credential history:** removed a blanket prohibition on rotating a legacy updater
  token. The reference preserves the old-client dependency as context for evaluating
  an explicitly requested credential change; no credentials were accessed or changed.
- **Testing policy:** preserve scoped checks and the explicit-request full-suite rule;
  documentation edits do not trigger application suites. Match regression tests to
  the behavior and integration boundary rather than requiring one test shape always.

## Preserved constraints

Commit formatting and breaking-change migration guidance, database compatibility
and staged migrations, exact variant identity, session control ownership, Mini-App
Host/WebView isolation, Metro-safe imports, encrypted transport and ACK/restore
ordering, native-update compatibility, scoped brand tokens, deterministic video
frames, translation key parity, and applicable UI story coverage remain documented.
The detailed commit rules now have one maintained reference linked from root policy.

## Validation and limits

- Enumerated all tracked project instruction names and inspected the third-party
  same-name skill reference separately.
- Checked all entrypoint/reference local Markdown links, `@` includes, and fenced
  code blocks; entrypoint root commands resolve in `package.json`.
- Checked the changed architecture statements against the source files cited above,
  desktop logger/variant code, and migration policy tests.
- Updated inbound release/draft references to relocated sections.
- `git diff --check` passed. No application tests, releases, device actions, or live
  model evaluations were needed for this documentation-only follow-up.

This is a documentation consistency and instruction-scope review, not a fresh
runtime reproduction of every historical troubleshooting example retained in the
references. Future corrections should replace stale guidance, not add another
always-loaded exception.
