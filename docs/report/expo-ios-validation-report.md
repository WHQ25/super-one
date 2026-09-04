# Expo iOS Migration Validation Report

Status: **feature validation complete; evidence import pending approval**
Date: 2026-09-04
Evidence root: `docs/temp/expo-validation-2026-09-04/` (local-only, gitignored)

## Scope and environment

The migration was rebased onto local `main` at `753264f3`; branch
`feat/migrate-to-expo` is 11 commits ahead and 0 commits behind. Live validation used
an isolated SuperOne 0.61.0 development instance controlled through CDP, a local
Wrangler relay at `ws://127.0.0.1:8787`, and SuperOne's built-in device controls.
Computer Use was not used for simulator interaction.

- iPhone 17 Pro Max simulator, iOS 26.5
- iPad Pro 13-inch (M5) simulator, iOS 26.5
- App `SuperOne` 1.0.0 (1), bundle `com.superone.superone-remote`
- Final artifact: normally signed Xcode Release simulator build
- Harness: Claude Code, exercised through the development desktop app

Pairing URLs, temporary keys, and six-digit confirmation codes were never written to
this report or copied into evidence files.

## Outcome

The signed Release build launches, pairs with the development desktop, lists the real
worktree, opens and creates sessions, sends and streams chat responses, interrupts an
active response, changes permission mode, exposes slash and mention completion, opens
attachment pickers, controls a writable terminal, browses project directories, restores
a saved pairing after relaunch, and renders the live session in iPad split view.

One environment-limited case remains: downloading a project file reaches the client,
but the local Wrangler relay returns `503 R2 not configured`. Directory browsing and
the mobile error state are correct; end-to-end file bytes require an R2-enabled relay.

## Defects found and fixed during live validation

| Defect | Root cause | Resolution | Result |
|---|---|---|---|
| Desktop QR rejected on iOS | Pairing scheme classification was case-sensitive while the desktop emitted `SuperOne://` | Added case-insensitive pairing classification and regression coverage | pass |
| Pasted URL became `super one://` | iOS autocorrection altered the custom scheme | Disabled autocorrect/spellcheck for pairing input and normalized the known alteration | pass |
| Pairing crashed under Hermes | `crypto.getRandomValues` was unavailable | Added `expo-crypto` and a runtime crypto polyfill | pass |
| Terminal stayed visually `read-only` after ownership arrived | TerminalRuntime mutated fields without scheduling a React render | Mirrored writable/title state into React only when presentation changes | pass |

## Feature matrix

| Area | Check | Result | Evidence |
|---|---|---|---|
| Build | Signed iOS Release installs and launches | pass | `19-dev-release-pairing-ready.png` |
| Pairing | Invalid payload fails closed | pass | `06-invalid-pairing-rejected.mp4`, `07-invalid-pairing-error.png` |
| Pairing | Camera permission, scanner, cancel, denied state | pass | `08-open-qr-permission.mp4` through `15-camera-permission-denied.png` |
| Pairing | Real QR handshake and paired-device registration | pass | `21-live-paired-project-list.png`, `22-dev-paired-device.png` |
| Recovery | Saved pairing remains after app relaunch and reconnects | pass | pending evidence import |
| Projects | Real worktree appears and opens | pass | `21-live-paired-project-list.png`, `23-open-project-session-list.mp4` |
| Sessions | New remote session is created | pass | `24-create-remote-session.mp4`, `25-session-composer.png` |
| Chat | iOS prompt streams and receives exact reply | pass | `27-live-chat-send-stream.mp4`, `28-live-chat-response.png` |
| Chat | Active generation can be stopped | pass | pending evidence import |
| Composer | Permission mode switch | pass | `29-switch-permission-mode.mp4` |
| Composer | Slash-command and mention completion | pass | pending evidence import |
| Attachments | Image/PDF/File menu and native image picker | pass | `30-open-attachment-menu.mp4` through `33-image-picker.png` |
| Terminal | Open, claim ownership, run `pwd`, render output | pass | `34-open-terminal.mp4` through `36-terminal-pwd-output.png` |
| Terminal | Writable placeholder updates immediately | pass | pending evidence import |
| Files | Browse root directories and files | pass | pending evidence import |
| Files | Download bytes through local relay | environment-limited | local relay lacks R2; pending evidence import |
| iPhone layout | Pairing and active session remain usable in tested orientation | pass | `13-pairing-rotate-landscape.mp4`, `14-pairing-landscape.png`, live session evidence above |
| iPad layout | Portrait and landscape split-view session | pass | pending evidence import |

`26-send-message-from-ios.mp4` records the first send attempt before the Claude harness
was enabled in the isolated desktop instance. It is retained as diagnostic evidence,
not counted as a passing chat result.

## Automated verification

| Check | Result | Detail |
|---|---|---|
| Repository whitespace validation | pass | `git diff --check` |
| Monorepo TypeScript | pass | all workspace typecheck scripts exited 0 |
| Mobile release configuration | pass | shared resolution and EAS/runtime policy assertions |
| Mobile tests | pass | 23 files, 52 tests |
| Relay client tests | pass | 10 files, 58 tests |
| Final iOS Release build | pass | Xcode 26.6 / iOS Simulator 26.5, normal local signing, `BUILD SUCCEEDED` |

Vitest required execution outside the filesystem sandbox because the sandbox could not
resolve its localhost test server. The same commands passed once local loopback access
was available.

## Known limitation and release recommendation

The Expo migration is functionally ready based on the tested iPhone/iPad and desktop
flows. Before declaring file transfer production-ready, repeat one download and one
upload against a relay deployment with R2 configured. The earlier Alpha-only evidence
(`03`–`05`) is historical setup context; development-build evidence is authoritative for
the live acceptance result.
