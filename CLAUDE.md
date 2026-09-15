# SuperOne project guidance

SuperOne is a Bun workspaces monorepo: Electron desktop, Expo mobile, headless
CLI, Next.js web, relay, and shared runtime/UI/harness packages. Product features
should use shared event and environment contracts across supported harnesses.

## Read for the task

Use the relevant workspace's short `CLAUDE.md` and only the references needed for
the change. Reuse content already loaded; a local typo fix needs no architecture tour.

| Area | Guidance |
|---|---|
| Desktop, IPC, sessions, agent tools | [apps/desktop/CLAUDE.md](apps/desktop/CLAUDE.md) |
| Mobile shell, chat WebView, transport | [apps/mobile/CLAUDE.md](apps/mobile/CLAUDE.md) |
| Remote node, RPC, local/Docker labs | [apps/cli/CLAUDE.md](apps/cli/CLAUDE.md) |
| Website | [apps/web/CLAUDE.md](apps/web/CLAUDE.md) |
| Remotion compositions | [apps/video/CLAUDE.md](apps/video/CLAUDE.md) |
| Shared translations | [packages/shared/src/i18n/CLAUDE.md](packages/shared/src/i18n/CLAUDE.md) |
| Cross-package layout and TypeScript resolution | [repository.md](docs/development/repository.md) |
| Preparing a commit | [commit-messages.md](docs/development/commit-messages.md) |

## Conventions

- Use `bun` / `bunx`; root scripts delegate to workspaces. All packages use ES modules.
- Cross-package imports use `@superone/<package>` exports. Prefer relative imports
  inside a package; desktop's `@/` alias is renderer-only.
- Use shared `HarnessId` / capability data and `AgentEvent` contracts instead of
  adding harness-specific UI branches. Preserve explicit unsupported states.
- Commits are one logical change, in English: `<type>(<scope>): <subject>`.
  Use an established lowercase scope, imperative lowercase subject, no trailing
  period, at most 72 characters. Explain why in the body when useful; incompatible
  changes require a `BREAKING CHANGE:` footer and migration instructions.

## Commands and verification

Root `package.json` is the command catalog. Common commands:

```bash
bun run dev                 # Electron development
bun run dev:web             # website
bun run dev:mobile          # Expo dev client
bun run dev:cli:lab          # local remote node
bun run build:chat-view     # generated mobile chat/terminal documents
bun run typecheck:node      # desktop main/preload
bun run typecheck:web       # desktop renderer
bun run storybook           # shared UI + desktop stories
```

Run the smallest affected checks and fix failures caused by the requested change.
For desktop/shared/UI Vitest, run from `apps/desktop`:

```bash
bunx vitest run src/path/to/file.test.ts
bunx vitest related src/path/to/changed-file.ts
bunx vitest run --changed HEAD
```

Before committing code, run affected tests. Full suites (`bun run test` and
workspace-wide equivalents) run only when explicitly requested; they are not a
pre-commit gate. For changes to shared fixtures or suite-wide infrastructure,
explain the coverage limitation before proposing a full run. Documentation-only
edits need relevant link/command/content checks, not application test suites.
If a needed test is blocked by the sandbox, inspect the failure and use the
available permission mechanism for that specific operation; do not assume all
tests need unrestricted access.

Complete authorized implementation and relevant verification before handing it
back. Reuse the user's decisions and authorization within scope; ask when missing
information changes the result or required authorization. Report any specific
unresolved blocker rather than presenting an unchecked implementation as complete.

## UI coverage

New or changed UI includes colocated Storybook stories using production components.
Cover applicable loading, empty, error/retry, denied/disabled, success, expanded,
long-content, and narrow-layout states. Make meaningful interactions reproducible
without live credentials or real side effects, and check light/dark and translated
layouts where relevant. Provide the story location with the verified result.
