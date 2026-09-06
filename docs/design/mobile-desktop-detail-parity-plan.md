# Mobile desktop detail parity plan

Status: implementation in progress, 2026-09-05. The user authorized this plan.

## Implementation log

- Native file icons now render SVGs generated from the installed desktop Symbols
  package. File/folder lists, attachment cards and composer mention candidates use
  this renderer. Generated output includes 271 distinct SVGs and retains the MIT
  license. Desktop-reference tests cover generated filename/suffix mappings and
  named folders, case handling, compound extensions, remote paths and fallbacks.
- Added an application-window menu portal, anchored placement and menu rows.
  Generic selection fields use this foundation. Native Modal was rejected after
  Android testing showed it dismissed the editor keyboard. The portal preserves
  the native view hierarchy to prevent a second focus-loss issue from view
  flattening. Prompt modals have a local portal host.
- Phone composer now has the control row above a simple expanding input bar;
  tablet uses an integrated editor/toolbar. Phone Return inserts a newline.
- Harness icons now use generated desktop scene geometry and CSS motion profiles:
  seven brands, five states, compact/rich rendering and eighteen animations. The
  native renderer preserves independent Codex cloud/glyph layers, Claude limbs
  and keyboard, gradient layers, and generic unread/automation corner badges.
  Motion uses the native driver, pauses in the background and respects Reduce
  Motion. The obsolete manually copied mark data has been removed.
- Added an Icons preview gallery. Android light/dark visual checks verified all
  state artwork; enabling Reduce Motion stopped animation and revealed a fully
  opaque Codex veil, corrected to preserve the initial partial-opacity frame.
  The simulator's original animation setting was restored after review.
- Validation so far: ten focused icon/placement/motion tests pass; mobile TypeScript
  check passes. Android offline preview confirms Chinese draft retention, keyboard
  and input position preservation when opening and selecting the model menu.
  These checks do not establish full visual or functional parity.
- Permission selectors now use desktop-generated names, descriptions, icons and
  light/dark tones for every harness. Native rows retain the server's wire values
  and available set: Codex `auto` displays Approve for Me; DeepSeek `plan` displays
  Read-only. The launch configuration form uses the same harness-aware names.
- Added a model/effort menu with descriptions, OpenCode slash-prefix grouping,
  search for large catalogs, current provider identity, refresh/error feedback,
  and selected checkmarks. Phone retains its separate effort shortcut; tablet
  uses a combined trigger. Refresh preserves current selections. Opening settings
  no longer replaces those selections with defaults. Provider changes clear the
  previous catalog while fresh data is requested.
- Header session actions now use an anchored action menu and the title displays
  the active harness artwork, including its running state. Android offline review
  confirmed permission selection updates the trigger and model/effort rows render.
- Latest scoped selection checks: 13 tests across permission presentation, model
  selection, harness capabilities and popover placement pass. Advanced provider,
  service-tier/catalog-parameter controls and full interaction QA remain pending.
- Remaining: real-session state wiring audit, long-list animation performance,
  remaining file reference surfaces; advanced selector controls; remaining action menus;
  slash/mention popup parity; actual inline mention chips and editor feasibility;
  tablet, dark-theme, accessibility and new interaction regression coverage.
- Slash/mention suggestions now have scrollable groups and counts, command match
  emphasis, argument hints, descriptions, and file/harness identities. Removed
  the eight-result truncation. Mention search retains remote labels/descriptions
  and exposes loading, empty and error/retry states.
- Extracted suggestion state from the application root. Native selection events
  now drive mention queries; insertion preserves trailing draft text and requests
  a one-shot caret position. Noncollapsed selections close suggestions; old search
  replies are ignored after clearing or changing runtime/context. Slash queries
  now close on tabs/newlines as well as spaces.
- Eleven scoped cursor/mention/slash tests and mobile TypeScript pass. This proves
  string-edit boundaries and catalog filtering, not native IME ordering or chip
  behavior. Native cursor/selection QA, search race interaction coverage, inline
  token editing and external-keyboard navigation remain pending.
- Added the structured native mention document foundation. Each token occupies
  one UTF-16 object position while retaining kind, full value and display name.
  Range edits preserve adjacent tokens and remove selected tokens atomically;
  clipboard text stays plain. Serialization uses desktop shared tag helpers.
  Seven tests cover native offsets, insertion, deletion, mixed selections, text
  replacement adjacent to chips and identity recovery with the actual desktop
  bubble parser. Mobile TypeScript passes. This model is not yet wired into the
  production composer; no native chip rendering or IME fidelity is claimed.

### Native editor prototype contract

- Android prototype source now lives in `apps/mobile/modules/mention-editor` and
  is recognized by Expo autolinking. The `Chip editor` preview mounts its EditText
  view, shows native selection/composition/event state, and inserts a file token
  at the current selection. Old dev clients show an explicit rebuild notice.
  Commands reject stale event counts and active composition; native text owns
  span positions between commands. TypeScript and `:superone-mention-editor:compileDebugKotlin` pass.
  Development-client rebuild and device interaction validation remain pending. Current prototype chips
  draw labels only; identity artwork, clipboard handling, accessibility, iOS and
  production integration remain required.
- Android prebuild and full arm64 development-client assembly pass. The existing
  simulator app has a different signing key, so the generated (ignored) Gradle
  debug config uses `.mentionpreview` as an application-id suffix. Installed the
  separate test app without deleting/replacing existing app data. It loads the
  existing Metro preview on port 8082.
- Android device review confirms native inline label rendering, explicit file
  insertion (two to three token spans), and backspace removal (three to two spans)
  preserving the adjacent draft. Reading that actual native snapshot and
  serializing it retained `src/app.ts` and the `codex-base` agent reference.
  Native copy/cut now expand chips to plain paths/labels; paste strips object
  placeholders and never creates tokens. Clipboard interaction QA, Chinese IME
  composing behavior and accessibility remain pending. Restored simulator
  transition animation scale to its original 1.0 after inspection.
- Eight structured-document tests pass, including native span-order recovery and
  rejection of duplicate/misplaced identities. TypeScript passes. The separate
  test-client deployment is not evidence of production composer integration.
- Added the iOS UITextView/NSTextAttachment prototype with the same command and
  snapshot fields as Android, including UTF-16 positions, composition rejection,
  event-count checks and plain-text copy/cut/paste. The shared preview now permits
  either platform when its native module is present. iOS prebuild, CocoaPods
  integration and TypeScript checks pass. The new Swift files compile for arm64 and x86_64. Full client linking fails
  for both architectures because prebuilt React Native core lacks development
  symbols (`RCTPackagerConnection`, `RCTPerfMonitor`, `RCTReconnectingWebSocket`
  and `Sealable`). Reinstalling Pods with `RCT_USE_PREBUILT_RNCORE=0` to verify
  against source-built core. iOS device behavior remains unproven.
- Source-built React Native core resolves the iOS linker failure; the complete
  arm64 simulator client now builds and runs on the controlled iPad. Native inline
  rendering, insertion and whole-attachment backspace deletion were verified.
  Native UIKit paste of Chinese text preserved both file and agent attachments;
  serialization of that actual snapshot retained `src/app.ts` and `codex-base`.
- Testing caveat: the device tool's non-ASCII `type` path uses accessibility text
  insertion, with an AXValue whole-string fallback. It lost attachment identities
  in this fixture; do not mistake that for the clipboard path or Chinese IME
  evidence. Reset the fixture, supplied Chinese text through `simctl pbcopy`, then
  tapped UIKit's Paste menu: that path preserved identities. Actual Pinyin marked
  text remains to be tested. Restored hardware keyboard connection after review.
- Extracted `NativeMentionEditor` as a reusable boundary used by the preview. It
  validates native identities and positions before exposing a sendable document,
  accepts backward Android ranges, and ignores older event counts. Invalid
  snapshots surface an error while the consumer retains its last valid draft.
  Twelve scoped native-document/boundary tests and TypeScript pass. Production
  integration, identity artwork and full accessibility/IME QA remain pending.
- Native file/directory chip artwork now comes from build-time PNGs generated
  directly from the desktop Symbols SVG registry and current theme foregrounds.
  Generation produces 276 deduplicated 128px images across six ink variants
  (about 1 MB JSON). A pinned Sharp dev dependency runs only during generation;
  `generate:icons` / `check:icons` include this artifact. File rows remain SVG.
- Android spans and iOS text attachments accept artwork separately from text
  commands. Image/theme changes redraw without replacing the native draft.
  The temporary hidden-SVG exporter was removed after Android rendering and
  theme-change timing proved unreliable. Android dark and iPad light visual
  checks confirm the TypeScript artwork inside the file chip; no hidden export
  views remain in the implementation.
- Both native clients build. Five scoped file/artwork tests verify all desktop
  mapping coverage, all theme variants, PNG signatures/dimensions and remote
  path behavior; generated-artifact check passes. TypeScript passes. Additional
  chip identities (agent/capability/etc.), directory visual fixtures, cold-start
  regressions and final large-text review remain pending.

- Use a local Expo module (autolinking supports `apps/mobile/modules`) with a
  UITextView attachment renderer on iOS and an EditText span renderer on Android.
  Both consume the same token identities and UTF-16 offsets from the document
  model. This is a proposed implementation pending native prototype validation.
- Keep composing text and selection native-owned. Emit edits with native event
  counts; reject stale JS updates and never reset the whole attributed document
  during marked/composing text. A chip occupies one object position, enabling
  native caret movement and whole-token deletion without pretending its label
  is editable text.
- Export plain labels/paths for ordinary clipboard copy. Only explicit structured
  insertion creates a token; plain pasted `@words` must remain text. Serialize
  selected tokens with desktop tags only at the send boundary.
- Prototype in the production-component preview first. Required evidence before
  replacing TextInput: Chinese marked-text commit/cancel, backspace on either
  side of a chip, mixed-range deletion, copy/paste, accessibility reading and
  external-keyboard movement on both platforms. Test rapid input against delayed
  JS acknowledgements. Restore draft identity and cursor across rotation.

## Design decision

Desktop is the reference for icon artwork, semantic colors, menu hierarchy,
selector content, suggestions and mention chips. Phone composer layout follows
Flutter: a compact status/control row ABOVE a simple input bar, with attachment
and send/stop actions beside the input. Tablet composer follows desktop's unified
editor and toolbar. This supersedes the previous redesign's unified composer
layout for both sizes. Both layouts share draft, selection and submission logic.

## Source evidence

- Desktop `components/harness/resolve-session-icon.tsx` resolves seven brand
  components in `packages/ui/src/components/harness`, including ACP brand
  variants. Session artwork supports default, running, background, unseen and
  automation states plus compact/rich rendering. Mobile currently renders static
  SVG marks and only dims ended/disposed states.
- `packages/ui/src/components/ui/FileIcon.tsx` uses `@react-symbols/icons` for
  filename and folder-name mapping. Mobile file rows use a few extension groups
  mapped to generic Lucide icons.
- Desktop `ModelSelector.tsx` delegates to harness-specific selectors. Mobile
  `SelectionField` reduces model and effort selection to generic sheet rows.
- Desktop `PermissionModePopover.tsx` uses an anchored top popover with mode
  icons, colors and eligibility-aware rows. Native menus currently overuse sheets.
- Desktop `ChatInput.tsx` renders grouped command/skill suggestions, counts,
  matched-text emphasis, argument hints, descriptions and loading feedback.
- Desktop `MentionPopup.tsx`, `MentionChip.tsx` and `mention-node.ts` distinguish
  resource and capability identities; chips are structured editor nodes. Native
  composer currently inserts mentions as text and uses generic suggestion icons.
- Flutter `lib/chat_page.dart` places `_buildStatusRow` before `_buildInputRow`;
  status contains model, effort, permission and contextual indicators. The input
  is a one-line rounded field that expands, with adjacent attachment/send actions.

## Implementation sequence and acceptance

| Step | Work | Acceptance |
| --- | --- | --- |
| 1. Reference inventory | Build a desktop/mobile component and state matrix. Include toolbar, drawer, session rows, files, attachment previews, tool rows, menus, selectors and chips. Capture matching reference states. Prototype native inline mention editing before finalizing composer internals. | Each visual has a named desktop source; missing remote capabilities are explicitly recorded. Choose a viable chip editor after IME/cursor/deletion trials. |
| 2. Shared icon foundation | Reuse or generate platform-neutral artwork and identity mapping from desktop sources; provide RN SVG rendering. Preserve branded session states and compact/rich behavior. Port Symbols filename/folder mapping, including special filenames, unknown types and fallback. Standardize action icon size/stroke/alignment. | Same identity in drawer, header, landing, mentions, file list and attachment views; no independent hand-maintained duplicate registry. Reduced-motion behavior and long-list performance verified. |
| 3. Menu and popover primitives | Create native anchored popover, action menu and selectable menu-row primitives. Match desktop surface, border, radius, shadow, separators, leading icons, trailing checks, destructive/disabled states and focus treatment. | Menus stay anchored when space permits, reposition around keyboard/screen edges, and dismiss predictably. Use sheets only where constrained height or complex content requires them, preserving the same content hierarchy. Touch targets remain at least 44 points. |
| 4. Specialized selectors and suggestions | Replace generic model selection with harness-aware presentation; retain provider/model grouping, descriptions and supported effort controls. Align permission names/icons/colors/descriptions/eligibility. Align slash groups, argument hints and matches; mention categories, paths, brand/file icons and navigation. | Every supported harness exposes only valid options. Current selection and unavailable reasons are explicit. Loading, empty, error/retry and selection states work. No hard-coded truncation hiding results; external-keyboard navigation works on tablet. |
| 5. Mention chips and adaptive composer | Implement structured mention tokens with desktop resource/blended styles and identity icons. Phone: status row above, simple expanding input bar below. Tablet: desktop editor container and toolbar. Keep attachment previews, suggestions and pending context coherent in both layouts. | Insert, move cursor, delete whole token, paste, edit around chips, serialize, send and restore drafts correctly with Chinese IME. Sent messages resolve the same identity. Rotation/split-view preserves draft, attachments and selection. Sending/stopping/queueing keep existing behavior. |
| 6. Visual and functional acceptance | Extend existing production-component preview with state fixtures and compare phone/tablet to desktop references. Add targeted interaction coverage for new menus, selectors, chips and responsive composer; retain prompt regressions. | Review light/dark, narrow phone, tablet portrait/landscape/split view, keyboard open, large text, long names, session states and supported harnesses. Distinguish visual comparison from behavioral test coverage. |

## Implementation boundaries

- Share semantic definitions and assets, with separate DOM and native renderers;
  do not import Electron stores or Radix DOM components into React Native.
- Keep the shared chat-view transcript renderer. Editor feasibility must be
  resolved explicitly: plain TextInput text with decorative chips elsewhere does
  not satisfy inline mention parity. Prefer a native-compatible token editor;
  evaluate alternatives against IME, accessibility and keyboard requirements.
- Preserve all supported harnesses, including ACP brand variants. Flutter's
  two-provider implementation determines phone layout, not capability scope.
- Audit each desktop option against remote protocol availability. Implement
  supported options; document any required transport work rather than displaying
  nonfunctional controls or fabricating eligibility.
- Use the existing responsive shell decision, with available composer width and
  split-view constraints considered. Keep layout separate from session state.
- Existing full-page redesign changes remain in place. This pass concentrates
  on the shared components and interaction details identified above.

## Delivery checkpoints

1. Reviewable icon/state gallery and phone/tablet composer layout fixtures.
2. Menus, specialized selectors and suggestions integrated with actual state.
3. Inline chips and both composer layouts integrated, followed by scoped visual
   and functional verification. Commit in coherent increments when authorized.

### Native mention identity glyphs (2026-09-05)

- Generate native PNGs for project agents, directories, sessions and stored capabilities directly from the literal Lucide/color definitions in desktop `MentionChip.tsx`. The generator fails if an expected mapping stops being extractable; no independent mobile color table is maintained.
- Native chip artwork now resolves these glyphs in both themes. Directory chips use the desktop blue Folder, while file browser and suggestion rows retain Symbols filename/folder matching.
- Suggestion rows resolve `agent-profile` references to harness marks; capabilities, sessions and apps receive separate groups instead of falling into files. App marks currently remain generic fallbacks; remote app artwork and live provider discovery are still pending. Existing legacy harness shortcuts in `agent` rows also await replacement by real provider targets.
- Verified: mobile TypeScript, four scoped glyph/file-artwork tests, deterministic generation check, and iPad light native preview showing seven glyph-bearing chips with native identities retained (7 tokens, event 2). Android and dark-theme visual verification for these new glyphs are still pending.
- This does not complete mention parity: branded agent-profile attachments, resource/blended chip styling, accessibility, IME checks and production composer integration remain open.

### Native resource/blended chip styling (2026-09-05)

- Corrected the earlier border assumption against current desktop CSS: resource chips use muted fill and no outline; blended chips have no fill and use muted foreground. Native iOS and Android now follow this distinction, with 0.125/0.25 em outer spacing, 0.35 em resource padding, 0.25 em icon gap and corner radius.
- The native bridge receives blended kinds from shared capability IDs plus agent-profile, session and desktop-app, avoiding separate per-platform identity lists. Style and artwork changes redraw existing attachments without replacing the draft.
- Verified TypeScript and full incremental iOS/Android development builds; both new clients installed. iPad dark preview retains seven native chip identities and event count 2 after theme switching. Android visual checks, font scaling and final baseline alignment against surrounding text remain open.
- Native editor remains preview-only. Branded agent-profile attachment artwork and the complete production editing/send flow are not yet finished.

### Android chip display-list refresh and input prerequisites (2026-09-05)

- Device verification exposed a real Android-only failure: seven PNGs reached native code and decoded successfully, but new chip icons stayed invisible until another character was typed. `TextView` retained ReplacementSpan measurement/drawing caches; view-level invalidate/requestLayout alone was insufficient.
- Artwork and chip-style updates now replace only the affected native ChipSpan objects, notifying the text SpanWatcher without replacing text, selection or composing spans. Temporary native count logging was removed after diagnosis. Preview retains image counts for visible fixture diagnostics.
- Verified cold-start Android preview: loading seven chips and changing to dark theme displays all seven glyphs without typing; selection stays 14–14 and event count stays 2. Both resource and blended styles are visible. Restored the device animation setting to its original 1.0.
- Added native editable, placeholder and editor accessibility-label props for eventual production composer integration. iOS includes a non-accessible placeholder label; Android uses the native hint. Disabling resigns focus/hides the keyboard. TypeScript and both native builds pass; Android exposes Message as the native editor label. Empty-placeholder and disabled-state interaction checks, iOS installation of these latest input props, IME accessibility coverage and production integration remain pending.

### Native suggestion transaction pipeline (2026-09-05)

- Added a reusable selection-to-command adapter: native UTF-16 query range, event-count guard, structured token identity, and trailing text preservation. Composing text, noncollapsed selections and unsupported kinds produce no command. Directory traversal remains editable @path text. Project-agent names are never fabricated into provider configuration refs.
- Wired the production MentionSuggestions component into the native editor fixture, replacing an active @query with the chosen chip through the same adapter. Sendable serialization continues to use the acknowledged native document, not an optimistic JS replacement.
- Verified three scoped selection-to-desktop-parser tests and mobile TypeScript. Android device flow: open query, select src/中文 file.ts, observe 7 → 8 native chips and images, inspect serialized draft containing the file identity. Restored animation scale to 1.0 after the test.
- This prepares production integration but does not switch ChatComposer yet. Its draft/search state still uses plain strings, and native auto-height, keyboard-submit behavior, live provider targets, IME/accessibility and draft lifecycle must be connected and verified before replacing that path.

### Native composer auto-height (2026-09-05)

- Added an independent content-height event on UITextView/EditText. The RN wrapper optionally clamps native measurements between caller-selected minimum and maximum heights; resizing does not emit a document edit or replace text. Android padding now uses density-scaled 12/10 dp instead of raw pixels.
- Native fixture uses 42–144 points. Both rebuilt clients installed and tested: 12-line draft grows to 144, clearing returns to 42 and restores the placeholder. Native document event counts increase only for the actual replacement commands. iPad scroll gesture reaches Line 12 inside the capped editor; Android seven-icon fixture wraps to two lines and grows to about 58 dp without clipping.
- Verified mobile TypeScript, both native builds, device layout bounds and rendered screenshots. Android animation scale restored to 1.0. Android long-text scrolling, rotation/font scaling, keyboard-submit behavior and production draft integration remain to be verified/implemented; this is still a preview path.

### Native keyboard submit behavior (2026-09-05)

- Added newline/submit modes and a versioned native submit event. The RN bridge only forwards a matching, validated, noncomposing draft after the existing 120 ms input settle window. Invalid snapshots clear the submit candidate. Native iOS marked text and Android composing spans also gate submission.
- iOS switches the keyboard return label to Send in submit mode; paste inserts literal text and a Shift+Return key command preserves an explicit newline. Android handles IME Send and Enter key events without duplicate key-up submissions; Shift+Enter falls through to normal editing.
- Both native builds and mobile TypeScript pass. Device checks: iPad screen Return and Android injected Enter each add a newline with zero submissions in newline mode; submit mode increments the preview submission counter once without changing text, native chip count or edit event count. Restored iPad hardware keyboard connection and Android animation scale.
- Actual Pinyin composition/confirmation, hardware Shift+Enter and literal-newline paste still need dedicated device checks. Preview submit only displays serialization; no message was sent. Production ChatComposer draft integration remains open.

### Production native composer integration (2026-09-05)

- ChatComposer now mounts NativeComposerInput when supplied the production structured-draft binding and the native module exists. Phone status-above-input and tablet unified editor/toolbar layouts are preserved; clients without the module retain TextInput. The production app and offline ChatScreen fixture share this binding.
- Explicit native transactions handle mention insertion, slash replacement and successful-send clearing. Native typing remains uncontrolled, rejected/pending/composing edits cannot be submitted, and only validated native snapshots feed the draft. Suggestion search now accepts actual native selection and suppresses results during composition.
- Extracted structured draft lifecycle from the app root. The document survives editor unmount/remount; session titles use plain mention labels while runtime.send receives desktop-compatible serialized identities. Revision checks preserve edits made during an in-flight send, including identity-only changes with identical placeholder text. Newly added attachments are retained when the earlier attachment batch completes.
- Verified mobile TypeScript and 18 scoped draft/selection/native-boundary/document tests. iPad production-component fixture: select a Chinese file, visit Settings and return with the chip intact, send offline and observe cleared input plus the file identity in the rendered message. Android phone fixture: file candidate inserts a visible TS chip while keyboard remains open; status row remains above the simple input bar. No remote message was sent. Android animation scale restored.
- Remaining: live connected-session send/error/queue smoke, Pinyin/clipboard/external keyboard coverage, persisted drafts and session-scoped lifecycle audit, branded provider chip artwork and real provider discovery (legacy shortcuts remain), and sent-bubble chip visual parity. The transcript currently renders the identity but still needs desktop styling/icon alignment. Other items in the original parity plan also remain open.

### Sent-message mention parity (2026-09-05)

- Root cause of the malformed mobile file bubble: PortableUserContent passed structured user text into Markdown instead of the desktop mention parser. The browser rendered tag field contents as visible text.
- Moved the pure parser into a shared leaf module, retaining desktop re-exports. Mobile user messages now render literal text plus explicitly selected mention chips. Typed @words remain text; HTML is escaped rather than interpreted. This also matches desktop's literal user-text treatment.
- Extracted desktop mention CSS into shared UI styles and static Lucide identities into a shared component helper. Desktop and mobile transcript import these definitions; native artwork generation now reads the shared helper. File bubbles use desktop Symbols icons, directories use the desktop primary-tone Folder, and project-agent badges retain the desktop @label treatment.
- Verified desktop parser tests, mobile document/artwork tests, portable message-rendering tests, chat-view/mobile TypeScript, and rebuilt embedded chat HTML. iPad rendered screenshot shows TS + 中文 file.ts in the sent bubble, without raw protocol fields. No remote message was sent.
- Provider brand marks and dynamic miniapp/desktop-app icons still use neutral fallbacks in the portable transcript; those are not complete. Native agent-profile artwork, live provider discovery, IME/accessibility and the other original parity requirements remain open.

### Authoritative provider mention discovery (2026-09-05)

- Extracted desktop remote mention search into a focused module. The existing search_mentions response now adds agentTargets from listAgentMentionTargets, the same usable-provider registry used by desktop collaboration. Resource search retains the active session cwd and project-agent discovery.
- Removed hardcoded Claude/Codex/Grok mobile candidates. Mobile validates returned target records, matches slugs/display names/aliases and retains exact provider refs (including custom providers and ACP suffixes). Project agents always use the project-agent glyph; a project agent named codex is no longer disguised as the Codex provider.
- A shared mobile request helper serves both ChatRuntime and the new-session path via the connected RelayClient, so targets/files can be queried before a session exists. Existing query-generation guards also reject responses from a replaced idle client. Older hosts without agentTargets still return resources and do not receive invented provider identities.
- Verified mobile and desktop-main TypeScript, nine mobile discovery/composer tests and 39 scoped desktop registry tests. The tests cover the no-session request path and provider-ref serialization, but the changed desktop service has not yet been verified through a live mobile connection.
- Native provider chip artwork, complete capability gating/reminders, transcript brand/app artwork and the remaining plan items stay open.

### Shared capability availability (2026-09-05)

- Desktop popup and remote search now use one shared availability function: Computer requires a supported host platform (currently macOS) plus computerUseEnabled; Browser requires cdpEnabled; Widget/Debug retain desktop availability. This only controls candidates and does not grant tool permission.
- Remote search returns capabilityIds. Mobile uses shared capability names/descriptions and only offers the returned identities; older hosts retain Widget/Debug fallback. Invalid ids are ignored, and an explicit empty list stays empty. Metadata is cached for the current search context to prevent candidate flicker during typing, then reset when context changes.
- Verified 15 focused mobile/desktop capability and identity tests, mobile TypeScript and desktop-main TypeScript. Desktop renderer typecheck is not green: diagnostics are in Markdown consumers and UI React/ref component types, outside the capability files changed in this step. See /private/tmp/superone-mention-capabilities-web.log; baseline cause is not yet established. Do not count full renderer typecheck as passed.
- Live host setting changes, capability reminder parity, native branded chips and the remaining UI plan requirements still need work.

### Shared transcript provider artwork (2026-09-05)

- Moved the desktop session-icon resolver and agent-profile chip icon into shared UI. Desktop keeps its resolver import path through a re-export; mobile transcript now uses the same compact idle brand components for Claude, Codex, Grok, OpenCode, Cursor, DeepSeek and generic ACP. Unknown providers keep the neutral fallback.
- DeepSeek imports the color SVG leaf rather than the entire icon registry. The portable test runner transforms that package's extensionless ESM imports.
- Verified 13 portable mention tests, nine desktop resolver tests, chat-view TypeScript and the offline document build. A focused Playwright check hydrates seven provider identities in the built document, checks visible SVG bounds in both themes, and captures screenshots; inspected light/dark captures show the actual marks within their chip boxes.
- This closes the transcript provider fallback gap only. Native input attachments still need branded PNG artwork; dynamic app artwork, live remote discovery/send, IME/accessibility and the rest of this plan remain incomplete. The previously recorded full desktop renderer typecheck failure is still unresolved.

### Native provider mention artwork (2026-09-05)

- Added build-time rendering of the complete shared AgentProfileIcon and compiled chat-view stylesheet into transparent 128px PNGs. This preserves CSS layers such as Claude's legs. Generation freezes animations and blocks network requests; no browser or image conversion runs during native editing.
- The production artwork hook now resolves agent-profile refs, including custom provider ids and ACP aliases. All mobile theme inks are covered; unknown providers receive the neutral desktop Bot. The generated output deduplicates to 24 images and passes a repeat-generation byte comparison.
- A transparency test caught an opaque canvas caused by the compiled root background; the generator now overrides the canvas background explicitly. Six focused native artwork tests, mobile TypeScript and diff checks pass.
- iPad native editor shows seven brands plus the unknown-provider fallback across two lines. Inspected light/dark device captures show transparent marks; theme switching preserves eight chips, eight images, selection 16–16 and event count 2. This turn did not verify the new images on Android or perform a real remote send.
- Android rendering, dynamic app artwork, live discovery/send, IME/accessibility and the other original plan items remain open. Full desktop renderer typecheck is still not counted as passing.

### Android brand verification and iOS Dynamic Type (2026-09-05)

- Android native preview renders seven provider brands plus the unknown fallback immediately, with transparent backgrounds and two-line wrapping at 411px. Inspected light/dark device screenshots. Theme switching and portrait → landscape → portrait preserve eight chips, eight images, selection 16–16 and event count 2. Restored transition_animation_scale to its original 1.0.
- Fixed the iOS native editor's constant 15pt font: UIFontMetrics now scales the base font using the view's content-size trait. Existing text attributes, placeholder and attachment artwork update together; selection and token identities are retained. Style changes defer while IME marked text exists and retry on subsequent text/selection callbacks.
- Rebuilt and installed the iOS client successfully. Changed the controlled iPad from large to accessibility-medium (RN reports font scale 1.79) and back. The mixed Chinese/file/provider draft visibly scales, its editor height grows and returns to 42pt, and two tokens, selection 14–14 and event count 1 remain unchanged. Restored the original large setting. Actual IME composition during a size change remains unverified.
- The large-text capture also exposes clipping in surrounding RN preview/sidebar labels when the system size changes live. That requires further investigation; this check only establishes native editor scaling, not whole-screen accessibility acceptance. Original live-connection, popup, selector and other remaining plan requirements still apply.

### Live RN text measurement (2026-09-05)

- Reproduced the clipping at accessibility-medium: native text draws larger while its paragraph retains the earlier bounds. Changing the theme immediately corrects those bounds. The installed RN 0.81 Fabric paragraph caches content and dirties measurement when props change; the labels do not have fixed height constraints.
- Added a ref-forwarding native Text wrapper that subscribes to system font scale and updates a text-layout prop (`maxFontSizeMultiplier`). Its default remains above the current scale, so system text is not capped. This forces remeasurement without remounting controls or the composer. Routed the app's 39 native Text consumers through it, including prompts and menus. Explicit multiplier limits remain supported.
- Allowed tablet sidebar action buttons to wrap; after remeasurement their enlarged labels otherwise overflow the fixed sidebar width.
- iPad live large → accessibility-medium → extra-small → large checks show immediate paragraph resizing without a theme change. Inspected the large-font screenshot: the formerly clipped preview descriptions/status labels are complete, sidebar actions stay within their column, and the mixed draft retains two tokens, selection 14–14 and event count 1. Original system category large restored. Mobile TypeScript and diff checks pass.
- This fixes the observed live measurement regression, not full accessibility acceptance: extreme-size phone layouts, all popups, Android live size changes, screen readers and the remaining original parity work still need verification.

### Menu geometry and full-catalog interaction (2026-09-05)

- Anchored menus now invalidate their old trigger coordinates on system font-scale and safe-area changes as well as window-size changes. Closing or unmounting a trigger also invalidates in-flight measurements, preventing a late callback from reopening it.
- Expanded the offline model catalog to 14 entries to exercise the production search field and long-list layout. A fresh iPad client load verified searching for 12 with the screen keyboard, selecting Catalog model 12, and updating the trigger with effort hidden for that model.
- With a real native draft present and the keyboard open, changing system size from large to accessibility-medium closes the old permission menu. Reopening measures the new trigger; inspected the device capture shows complete wrapped descriptions within the screen above the keyboard. Selecting Plan Mode updates the trigger while draft text and Catalog model 12 remain intact.
- Ten scoped placement/model/permission tests and mobile TypeScript pass. Restored system category large and the original hardware-keyboard connection. These checks use offline production components; live host RPC, Android search/resize interaction, advanced selector controls and the other original plan items remain unverified.

### Composer action affordances (2026-09-05)

- Replaced the phone composer's filled send square with the Flutter-style plain north arrow. Disabled send uses a subdued primary tint, enabled send uses the active primary color, and streaming uses the error-colored outlined stop glyph. The attachment action remains a plain paperclip.
- Tablet send/stop now uses the desktop 26-point circular outline inside the existing 44-point touch target. The shared icon button exposes semantic tone, chrome and icon-size variants while preserving the existing default treatment for unrelated controls.
- The offline Chat fixture now holds a streaming state so stop can be reviewed directly. Android phone checks covered disabled send, enabled send with the keyboard open and streaming stop; iPad checked the tablet circular send control. Accessibility labels and 44-point bounds remain present.
- Added validated deep links for application-page fixtures and a Maestro composer-actions flow. The Android light run passed 1/1: it asserts status/input structure, disabled and enabled send, performs a local send, then asserts stop. Prompt flows now close an open page preview before navigating to their fixture.
- Mobile TypeScript, three preview-route tests and diff checks pass. Android transition animation scale remains 1.0; the temporary animator-duration override was deleted to restore the original default. Maestro's native text-control settling makes this focused flow slow (5 minutes 43 seconds).
- Live send/interrupt transport behavior, rapid-tap behavior, dark/iOS automation and queued-message feedback still require connected or additional device checks.

### Dynamic app mention artwork (2026-09-05)

- Remote mention search now includes installed miniapps and, when the shared Computer capability is available, macOS desktop applications. Results carry stable app ids, display names, descriptions and best-effort PNG artwork sourced from the same manifest logos and bundle-icon resolver used by desktop.
- The host preserves file and agent results when any app catalog or icon lookup fails. Miniapp logos keep their aspect ratio, every transmitted icon is limited to 256KB, and mobile accepts only bounded inline PNG data rather than remote URLs or SVG payloads.
- Mobile suggestions render the supplied artwork with desktop's object-contain and 22% corner treatment. After selection, native composer attachments retain the PNG in a session-local identity cache while serialized mentions continue to contain only stable ids. Missing miniapp logos use desktop's exact default-app SVG rendered at build time; missing desktop-app icons reuse the shared emerald Computer pointer.
- Verified desktop-main and mobile TypeScript, deterministic artwork generation, two host search tests and nine mobile parsing/artwork tests. Android production-component preview shows a dynamic app mark, the desktop miniapp fallback and the desktop-app pointer together in the native editor with three acknowledged chips and images.
- The reduction protocol now carries a validated session-local artwork map only when its revision changes. The portable sent-message transcript uses the same selected app PNGs and shared fallbacks without adding image payloads to serialized prompts or every streaming patch. Android visual review confirms the dynamic Board mark, default miniapp box and blended desktop-app pointer survive from native chips into the message bubble.
- A live paired desktop/mobile search has not yet been exercised. Artwork for older app mentions loaded after a process restart still falls back until the host exposes an identity-artwork catalog independent of suggestion search.
