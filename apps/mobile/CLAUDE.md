# Mobile guidance

Expo dev-client app (`@superone/mobile`), using React Navigation native stack.
It requires native modules and does not run in Expo Go. Root rules apply.

## Read for the task

| Change | Reference |
|---|---|
| Chat WebView lifecycle, optimistic messages, attachments | [transcript.md](docs/agent-reference/transcript.md) |
| Workspace lists, drawer, tablet navigation, theme | [workspace.md](docs/agent-reference/workspace.md) |
| Composer, todos, slash commands, additional directories | [composer.md](docs/agent-reference/composer.md) |
| File preview, media, uploads/downloads | [files.md](docs/agent-reference/files.md) |
| Pairing, LAN/relay discovery, reconnect, restore, ACKs | [transport.md](docs/agent-reference/transport.md) |
| Native dependencies, identities, EAS, updates, release smoke | [native-builds.md](docs/agent-reference/native-builds.md) |
| Build prerequisites, Vitest/Jest, Maestro, offline previews | [testing.md](docs/agent-reference/testing.md) |

## Boundaries

- RN owns native input, navigation, session reduction, and transport. Chat WebView
  paints reduction patches; it does not reduce `AgentEvent` again. Terminal frames
  do not participate in relay ACKs. Do not nest chat in an RN `ScrollView`.
- Projects and sessions share `WorkspaceList`; back from chat opens the drawer
  without ending the session. Drawer and tablet sidebar reuse the same list.
- Use `HARNESS_CAPABILITIES` and shared request types rather than reproducing the
  former Flutter app's Claude/Codex-only gates. Historical migration plans are
  background material, not a current implementation schedule.
- Import Metro-safe leaf `@superone/shared/*` modules. Node-only `attachment-store`
  and `git-clone` are blocked. Use native ports for file/crypto work.
- Theme comes from `src/theme`; preserve neutral mobile chrome and safe-area insets.
  Keep native input IME-safe and user-triggered RPC failures visible via `runUiAction`.
- Never log pairing secrets or event payloads. Preserve authenticated/encrypted
  transport, transfer limits, and server-owned permission fields.

Mobile scripts build generated chat/terminal HTML through `pre*` hooks. Native
module/config changes require a dev-client rebuild; JS changes use Metro. Generated
HTML and native build trees are ignored artifacts, not source to commit.

For checks, `.test.ts` uses Vitest and `.test.tsx` uses jest-expo. Follow the root
scoped-test policy. Use awaited interactions for multi-step component scenarios;
full device/release acceptance is only for the relevant delivery task.
