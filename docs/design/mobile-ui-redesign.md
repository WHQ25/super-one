# Mobile UI redesign: Flutter structure, desktop visual language

Status: implemented in the working tree with scoped validation, 2026-09-05.
This document records the original audit and the redesign. These changes have not
been committed or released.

The follow-up [desktop detail parity plan](./mobile-desktop-detail-parity-plan.md)
supersedes the unified phone/tablet composer proposal below: phones use Flutter's
status-above-input structure; tablets use the desktop composer structure.

## Evidence and scope

Reviewed the Flutter source at
`/Users/wuhangqi25/Developer/Projects/super-one-flutter/lib`, the current Expo
screens/components/theme, and desktop chat components. Current Expo and desktop
screens were also observed during the paired smoke session. Flutter descriptions
below are source-derived; the old binary was not launched for a pixel comparison.

Flutter's current connection path opens `ChatPage` directly (`home_screen.dart`,
`_openChatPage`). Independent project/session pages exist, but should not be
mistaken for its primary connected navigation. `ChatPage` switches between a new
session landing state and an active conversation, with `ChatDrawer` for projects
and history. Before this redesign, Expo used sequential pair/projects/sessions/chat routes.

## Flutter page inventory

| Surface | Existing Flutter composition | Reference |
| --- | --- | --- |
| Devices | 22-point title; My Devices section with count and refresh; device cards; bottom Pair New Device action; debug paste is a small action | `home_screen.dart::_buildDeviceList` |
| Scan / confirm pairing | Camera scanner is its own state; confirmation presents a large six-digit code with waiting feedback and cancellation | `home_screen.dart::_buildScanner`, `_buildPairingCode` |
| New session | Agent illustration, Powered by label, harness switch, project selector and Git/worktree controls; composer remains at the bottom; content moves upward for keyboard | `chat_page.dart::_buildContent` |
| Active chat | 68-point toolbar, 16-point medium title, 11-point secondary project/connection/branch context; menu on left, close on right; transcript and bottom composer | `chat_page.dart::_buildNavBar` |
| Project/session drawer | Desktop identity and connection at top; expandable projects; indented compact session rows; selected row gets a subtle background | `chat_drawer.dart` |
| Independent projects | Desktop name and connection above a divided folder list; muted paths, refresh and Add Project | `project_list_page.dart` |
| Independent session history | Project app bar; refresh/pagination; 12-radius cards, 14-point titles, 11-point metadata; swipe actions | `session_list_page.dart` |
| Files / folder selection | App bar, 44-point breadcrumb strip, file-type icons and rows; upload/new-folder actions; directory selection gets a bottom action | `file_browser.dart` |
| Terminal | Dark terminal surface; project subtitle; new-terminal action and tab strip; terminal viewport with shortcut-key strip | `terminal_page.dart` |
| Contextual sheets | Separate permission, question, plan and worktree sheets; model/effort/mode pickers opened from their context; attachment and mention/command overlays near composer | `permission_sheet.dart`, `question_sheet.dart`, `plan_approval_sheet.dart`, `worktree_sheet.dart`, `chat_page.dart` |

## Why the original Expo UI felt different

1. **One display title is used for unrelated surfaces.** `theme/styles.ts` maps
   the global title to `type.display` (24). `MobileHeader` uses it for chat, where
   Flutter used 16. Three trailing actions, a harness icon and two outlined
   badges leave little room for the actual conversation title.
2. **The composer is visually fragmented.** Permission mode sits above separate
   attachment, bordered text field and filled Send/Stop controls. Model and effort
   choices are in a project settings form. Flutter kept these near the input;
   desktop `ChatInput.tsx` uses one rounded container with its own control row.
3. **Sequential navigation replaces the workspace.** The missing new-session
   landing state and phone drawer make the app feel like a collection of forms.
4. **Metadata has equal visual weight.** Session provider, model, message count,
   time, branch and tags all become badges. Metadata needs ordering, truncation
   and selective emphasis rather than a wrapping wall of capsules.
5. **Tokens alone do not ensure consistency.** Expo already generates colors from
   desktop tokens, but its spacing, type roles, component shapes and action
   placement differ. Several screens still use raw Pressables with global styles
   alongside the newer shared primitives. For example, attachment and secondary
   controls reuse `btnText` intended for primary backgrounds.
6. **Native and transcript layout need one specification.** Global outer padding
   plus WebView content padding can compound. The observed transcript also breaks
   English words awkwardly. Inspect the actual CSS before assigning a root cause.

## Target rules

- Use Flutter's workspace navigation and contextual controls with current desktop
  colors, harness identity, tool presentation and action hierarchy.
- Keep React Native for shell/input/sheets and chat-view for the transcript.
  Do not introduce another transcript renderer or copy Flutter code.
- Introduce semantic type roles: navigation title 16–17, landing title 22–24,
  body 15–16, metadata 12–13. These are starting values for device review, not
  a request to reduce system font scaling.
- Use neutral navigation icons (18–20 visual size), with at least a 44-point
  interactive area. Use accent color for primary action, selection and active
  state, not every icon. Error color is reserved for errors/destructive choices.
- Assign spacing to each surface rather than padding the entire application.
  Shell, transcript and composer must agree on their horizontal content edges.
- Reuse desktop color/radius semantics; define explicit native component sizes.
  Preserve platform safe areas, keyboard avoidance, screen-reader labels and
  existing prompt test identifiers.
- Keep all supported harnesses. Flutter's Claude/Codex-only switch is a visual
  reference, not a capability restriction. Use a scalable harness picker.

## Improvement table

| Priority | Area / components | Proposed change | Acceptance |
| --- | --- | --- | --- |
| P0 | Theme roles, `Button`, new `IconButton`, `ListRow`, status indicator | Separate page and chat type scales; consistent hit areas; correct text colors for primary/secondary/ghost buttons; reduced badge use | Light/dark variants remain legible; long text and large font do not obscure controls |
| P0 | `MobileHeader` | Compact chat toolbar; drawer action, readable title, muted project/branch/status subtitle, one overflow action | Long session title has useful width; routine connected state is quiet; reconnection is explicit |
| P0 | Extract native `ChatComposer` from `ChatScreen` | Unified composer surface; attachment preview and send/stop icon; compact model/effort/mode controls adjacent to input; shared suggestion surface | Keyboard-visible input and send/stop stay accessible; multiline and Pinyin remain intact; distinguish current-session settings from next-session defaults |
| P0 | New-session landing surface | Agent identity, scalable harness picker, selected project/worktree, same composer as active chat | Start a session without visiting a long settings page; keyboard compresses landing content |
| P0 | Phone workspace drawer, reuse sidebar row model | Device context plus expandable projects and recent sessions; new-session action; retain tablet master/detail | Switch sessions without navigating back through projects; selected/streaming/pending states are distinguishable |
| P1 | Session rows / `SwipeSessionRow` | Title first, time trailing, one muted metadata line; tags/branch only when useful; quiet selection fill | No badge wall or height jump for ordinary rows; swipe actions remain discoverable and labeled |
| P1 | Transcript / chat-view theme | Align gutters, body type and line height with shell; audit word wrapping, user bubble, tool row density, code/diff overflow | English wraps at normal word boundaries; paths/code can scroll; both schemes match native chrome; protect desktop rendering |
| P1 | Shared sheet frame and picker rows | Consistent handle/header/body/footer; secondary dismissal versus primary approval; clear selection and validation | Existing 13 Maestro flows retain payload semantics; long plans and keyboard forms keep actions visible |
| P1 | Project settings and contextual pickers | Move frequent model/effort/mode selection to composer, worktree selection to landing; keep repository/extra-directory settings grouped | The UI says which session a setting affects; defaults are not mistaken for live-session controls |
| P1 | Devices, scanner, pairing | Quiet device identity/status; anchored primary pair action; development paste form behind a compact disclosure | Empty/loading/offline/error/confirmation each have a coherent layout; debug-only input remains debug-only |
| P2 | Project/file rows and breadcrumbs | Compact folder rows, path truncation, file-type icons, selected state and focused action menu | Deep paths stay navigable; empty, loading and read-error states are distinct |
| P2 | Terminal chrome | Dedicated terminal layout, compact shortcut keys and clear writable/read-only state; review Flutter tab parity separately | Avoid generic form styling around terminal; shortcuts remain usable with keyboard open |

## Delivery order and verification

1. Build a coherent chat slice: semantic primitives, compact header, unified
   composer, and new-session landing. Review on the actual Expo dev client in
   light/dark mode with keyboard up and down before rolling styles across pages.
2. Add phone drawer and compact session rows; reorganize contextual selection and
   project settings. Preserve the fixed leave-session/control-ownership behavior.
3. Align transcript, sheets, device/pairing, files and terminal. Add screenshot
   review cases for representative states; existing interaction tests do not
   constitute visual acceptance.

Compare the same fixture content, viewport, OS font scale and keyboard state.
Include long titles, long paths, empty state, streaming, reconnecting, disabled
send, long approval content and tablet rotation. Keep screenshots local rather
than committing them. Record visual review separately from automated assertions.

The previously reproduced history-restoration defect remains an independent
functional issue. A visual redesign must not be used to mark that defect fixed.


## Implementation map

| Surface | Implemented change | Main components |
| --- | --- | --- |
| Devices / pairing | Compact device rows, anchored pairing action, collapsible development input, flexible scanner | `PairingsScreen`, `ListRow`, `IconButton` |
| New session | Connection opens the workspace landing; first send creates the session; project and worktree selection remain contextual | `NewSessionLanding`, `ChatComposer` |
| Active chat | Compact toolbar and metadata, shared composer, model/effort beside input, image/PDF attachment strip, explicit session-start progress | `MobileHeader`, `ChatScreen`, `ChatComposer`, `AttachmentStrip` |
| Workspace navigation | Expandable projects with recent sessions, selected rows and loading/error states; tablet retains master/detail | `WorkspaceDrawer`, `TabletSessionSidebar`, `SessionRowContent` |
| Projects / history | Neutral folder rows, compact title/time/metadata, concealed swipe actions | `ProjectsScreen`, `SessionsScreen`, `SwipeSessionRow` |
| Settings | Contextual selection sheets, current-session model/effort labels, fixed active agent identity, separate next-session worktree options | `SettingsScreen`, `SelectionField` |
| Files | Root-preserving breadcrumbs, current folder scrolled into view, file icons, loading/empty/error/retry states | `FilesScreen`, `useRemoteDirectory` |
| Terminal | Dedicated viewport, compact control status, 44-point shortcut targets and send/control actions | `TerminalScreen`, `ConnectedTerminal` |
| Sheets | One keyboard-safe frame for permission/question/plan, worktree, device and file-receive surfaces | `PromptSheet`, `Sheet`, `PromptControls` |
| Transcript | Shell-aligned gutters, scalable body type, normal prose wrapping; code/tool presenters retained | `ChatView`, `ChatMessage`, scoped chat-view CSS |

The redesign preserves the Expo capability boundary. Flutter terminal tabs,
project creation, and folder creation are separate feature-parity work, not
new controls backed by nonexistent mobile actions.

History hydration now preserves the newest window when a saved viewport was at
the bottom, instead of restoring a stale end index. A deliberately scrolled
history position still restores its anchor. This has targeted unit coverage;
paired navigation must also be checked before recording the live defect fixed.


## Validation record (2026-09-05)

- Android 16 / Medium Phone API 36.1: all 13 native prompt flows passed in
  light (7m 20s) and dark (7m 28s). After the final primary/secondary action
  color adjustment, the dark permission/feedback flow passed again (1/1).
- Scoped mobile logic checks: 11 files / 41 tests passed; preview route and
  fixture checks: 2 files / 4 tests passed. Mobile TypeScript and diff whitespace
  checks passed. The offline chat and terminal documents were rebuilt.
- Paired Android review: device list, workspace landing and drawer, compact
  session rows, settings, breadcrumbs/file rows, error receive sheet, initial
  message/reply and second streamed reply were observed. System font scale 1.3
  was used for settings/file controls and chat; restored to 1.0 afterward.
- iPad Pro 11-inch (M5), iOS 26.5: reviewed the centered long-plan sheet with
  the software keyboard in landscape, the production master/detail landing,
  and dark terminal/shortcut/input layout using offline fixtures. This is
  visual review, not an iPad run of the full Maestro suite.
- The native catalog now exposes **Preview app screens**, with 11 deterministic
  page states, contextual drawer/worktree controls, and light/dark switching.
  Preview sends never execute a real agent or shell.

Local JUnit evidence:
`apps/mobile/.maestro/artifacts/2026-09-05T08-58-48-109Z/{light,dark}/report.xml`
and `2026-09-05T09-14-59-025Z/dark/report.xml` under the same artifacts directory.
Screenshots and reports remain ignored local artifacts.

Limits: the test desktop/relay processes stopped during the later paired checks;
the final two-turn leave/reopen history regression was not completed. The local
relay returned `503 R2 not configured` for file download, so its error presentation
was checked but download success was not. Android hardware Back needs a dedicated
repeatable flow. Physical-device release validation and a full iOS rerun remain
separate from this UI redesign.
