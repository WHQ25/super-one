# Changelog

All notable changes to SuperOne are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [0.18.5-alpha] - 2026-04-13

### Added

- Cmd+/- content zoom shortcuts for chat and file preview

### Fixed

- Syntax highlighting losing context across chunk boundaries in file preview
- Content clipping on resize by replacing CSS zoom with transform scale
- Code block highlighting in markdown files with YAML front matter

## [0.18.4-alpha] - 2026-04-12

### Added

- Markdown editing with syntax highlighting and auto-save in file preview

### Fixed

- Isolate permissionMode across sessions and scroll after plan approval
- Hold queued messages until step boundary for cancellability

### Performance

- Chunked syntax highlighting and minimap rendering for large files

## [0.18.3-alpha] - 2026-04-11

### Added

- ⌘, keyboard shortcut to toggle settings
- API version and `update_superone_types` MCP tool for mini-apps
- Enhanced standard app tool call display and grouping

### Fixed

- Use SDK replay UUIDs for file checkpoints and simplify rewind flow
- Persist `preapproved.json` for React template dev apps

### Other

- Add BSL 1.1 license

## [0.18.2-alpha] - 2026-04-10

### Added

- Overlay UI APIs for mini-apps (toast, tooltip, context menu)
- System bridge APIs and refactored message handling for mini-apps
- Filesystem protocol, tool lifecycle rebuild, slug-based appId, DnD polish
- Show claude.ai MCP servers in settings with toggle support
- Recipes guide, examples, and binary fs support for mini-app docs

### Fixed

- Always show app drawer even when no apps installed
- Persist rate limit dismiss across session switches
- Horizontal overflow on panel resize
- Support absolute paths for media file preview
- Guard `/review` and `/plan` popup to codex provider only
- Sync guides and React template types with actual API
- Exclude `preapproved.json` and `install.json` from packed `.s1app`

### Refactored

- Extract shared API runtime for bridge and preload

## [0.18.1-alpha] - 2026-04-09

### Added

- Tool preapproval, `.superone` protection, and apps settings
- Simplified scaffold tool, split guides by type, enhanced tool display

### Fixed

- Merge mac build jobs to fix auto-update architecture mismatch

### Performance

- Optimize file preview rendering and reduce panel expand jank

## [0.18.0-alpha] - 2026-04-08

### Added

- Overhauled canvas layout, install target, and UI polish
- Enhanced scaffold with mode/template support and UI improvements
- Permission model with access control, reasons, and install dialog
- Theme, `fs.watch`, and git bridge APIs for mini-apps

### Fixed

- Prevent idle browsed sessions from leaking into session list
- Reset detailed usage when model changes
- Notify frontend immediately when queued message is consumed
- Prevent draft text leaking across sessions
- Serialize hardBreak nodes as newlines in user messages
- Align useChatScroll tests with ResizeObserver-based settle timer

## [0.17.0-alpha] - 2026-04-06

### Added

- Mini-app platform with packaging, installation, and built-in MCP server
- Cmd+W shortcut to close active tab when panel is focused
- Persist activity panel layout and default to left side

### Fixed

- Show argument hints for skills in slash command UI
- Panel resize, chat overflow, and minimap responsiveness
- Trigger clampPanels on sidebar toggle
- Diff background width calculation for correct font size
- Activity panel absorbs window resize, disable single-group drag
- Chat overflow when left activity panel opens

## [0.16.2-alpha] - 2026-04-04

### Fixed

- Panel resize, chat overflow, and minimap responsiveness

## [0.16.1-alpha] - 2026-04-04

### Added

- Long-press ESC interrupt with animated stop button
- Dockview-based ActivityPanel replacing FilePanel
- Dev app scaffold and auto-detection workflow for mini-apps

### Fixed

- Use SDK cumulative cost directly instead of additive accumulation
- Decode URL-encoded file paths in markdown FileLink chips
- Render link safety modal via portal to cover full viewport
- Upgrade Electron 40→41 to fix pdfjs-dist compatibility

### Styling

- Refine table styles and add context usage hover feedback

## [0.16.0-alpha] - 2026-04-02

### Added

- Webview dev mode with DevTools and reload for canvas
- Mini-app system with MCP proxy for canvas
- Dev examples and miniapp-builder skill
- Paste chip for large text pastes

### Fixed

- Cross-session event routing race condition

### CI

- Simplify mac build, add workflow_dispatch with platform selector

## [0.15.0-alpha] - 2026-04-01

### Added

- Upgrade SDK to 0.2.89 with api_retry indicator, slash command & context UI improvements
- Provider-aware context window in ContextUsage

### Fixed

- Consolidate asarUnpack patterns to fix macOS universal build

## [0.14.3-alpha] - 2026-04-01

### Added

- Unique draft session IDs to isolate concurrent drafts
- Copy Working Directory and Open Folder to session context menu
- Isolate dev userData into project-local `.dev-data` directory

### Fixed

- Stop forwarding background session permissions to active session
- PDF preview resize race condition and Codex chat overflow

### Tests

- 220+ unit tests across settings store, MCP library, bash output watcher, and chat store

## [0.14.2-alpha] - 2026-03-31

### Added

- `/plan` slash command for Codex with plan approval flow (approve/reject)

### Fixed

- Codex session title and running indicator for mobile

## [0.14.1-alpha] - 2026-03-31

### Added

- Pixel-accurate DiffView content width using pretext

### Fixed

- Prioritize tool result over live state in ExitPlanMode block
- Stop metadata events from fragmenting streamed text chunks
- Resolve ghost interrupted messages and queued message support for remote sessions
- Clamp sidebar first when FilePanel opens to prevent chat overflow
- Resolve context window from selected model name instead of stale state

## [0.14.0-alpha] - 2026-03-29

### Added

- Replace prefireMessage with SDK priority queue and precise queued turn detection
- Restore @mention directory drill-down with scoped fuzzy search
- Collapsible permission prompt with space toggle

### Fixed

- Convert Codex items to content blocks for mobile history
- Pass mobile permission mode as initialize override

### Performance

- Throttle drag/resize with rAF and optimize DiffView virtualizer

### Tests

- ClaudeAgent init unit tests

## [0.13.1-alpha] - 2026-03-29

### Fixed

- Use cached models for mobile and stabilize fetchModels

## [0.13.0-alpha] - 2026-03-29

### Added

- Support Codex session resume and show codex sessions in list

## [0.12.4-alpha] - 2026-03-28

### Fixed

- Fetch models on first install when no projects exist

## [0.12.3-alpha] - 2026-03-27

### Added

- Enhanced background subagent visibility and interaction routing

### Fixed

- Create proper remote session when mobile resumes old session
- Preserve renamed session title on subsequent task runs
- Chunk large WebSocket responses to avoid Cloudflare 1MB limit

## [0.12.2-alpha] - 2026-03-25

### Added

- Show bash description inline in tool header and permission prompt
- Support video and audio media in markdown rendering

### Fixed

- Remove redundant applyPreferences on session rebuild
- Repair broken tests and add preference coverage

## [0.12.1-alpha] - 2026-03-25

### Added

- Image preview in markdown via media server

### Fixed

- Subagent elapsed time formatting
- Prevent slash menu from reopening on programmatic text set

## [0.12.0-alpha] - 2026-03-25

### Added

- Local media server for video/audio playback in chat and FilePanel
- Phone icon for remote session in project sidebar
- `set_permission_mode` command and selectedSuggestions support for remote
- Broadcast `interaction_resolved` when mobile resolves permissions
- Copy session ID context menu item

### Fixed

- Hide phantom "New session" for unhydrated background sessions
- Rename userSettings permission label to "all projects"
- Test connection spawning CLI without PATH
- Mermaid blocks not auto-converting to preview after streaming ends
- Preserve paragraph breaks between text segments in convert-trace
- Skip truncation for Agent tool_result summary
- Extract insight blocks from text for mobile rendering

### Refactored

- Replace batch timer with promise queue for event sending
- Denormalize session timestamps, extract ProjectSidebarRow
- Extract session runtimes and persist codex turns
- Extract splitTextIntoBlocks and enrich permission in convert-trace

## [0.11.5-alpha] - 2026-03-18

### Added

- Preferences page with project-level output style
- Reasoning summary for Codex, command group expansion and item streaming

### Fixed

- Nested code fences, insight blocks, scroll tracking, and permission overflow
- Checkpoint handling, rewind logging, and test mocks

## [0.11.4-alpha] - 2026-03-17

### Added

- Iframe gate, CDN allowlist, scroll fixes, and guideline updates for widgets

### Fixed

- Canvas placeholder, header layout, and sendPrompt behavior
- Prevent tiny trackpad scrolls from disabling auto-scroll during streaming

### Refactored

- Move theme toggle from sidebar to header titlebar
- Remove click-to-copy on user messages and text segments

## [0.11.3-alpha] - 2026-03-17

### Added

- Updated generative UI guidelines and improved widget rendering

### Fixed

- Disable single-dollar LaTeX to prevent currency symbol misparse
- Guard webContents.send against destroyed window

## [0.11.2-alpha] - 2026-03-17

### Added

- Download button, auto-resize iframe, and improved tool descriptions for widgets

### Fixed

- Use messageStreaming prop instead of session status for completion detection
- Create new widget MCP server per session to prevent connection failure
- Refocus editor after model/effort selector closes

## [0.11.1-alpha] - 2026-03-17

### Fixed

- Use Electron Helper to prevent child process dock icons on macOS

## [0.11.0-alpha] - 2026-03-17

### Added

- Generative UI with streaming preview (widget system)
- Mermaid diagram viewer with fullscreen, zoom/pan, and minimap
- Smart SVG sizing with fit-then-overflow strategy
- Improved copy behavior and mermaid preview
- LaTeX math rendering support via Streamdown math plugin

### Fixed

- Inherit process.env in session query env
- Use Electron as Node runtime in packaged builds

### Performance

- Lazy load messages and reduce re-renders

## [0.10.3-alpha] - 2026-03-15

### Added

- Auto-focus input when creating or switching sessions
- Improved sidebar styling, file tree drop zone, and image preview with zoom

### Fixed

- Auto-expand input area to fit placeholder text on narrow widths

### Refactored

- Unify tool group style and add inline file chip for Codex

### Tests

- 220 unit tests for 12 core modules (crypto, diff-utils, plugins, tool-block-utils, chat-input-utils, stall-utils, MessageBridge, session-history, mcp-config, discover-resources, claude-permissions, and more)

## [0.10.2-alpha] - 2026-03-15

### Fixed

- Handle missing folders gracefully on startup
- Use raw SDK description instead of splitting at separator
- Derive model display names from SDK data instead of hardcoding

## [0.10.1-alpha] - 2026-03-14

### Fixed

- Resolve SDK cli.js by package dir instead of exports map

## [0.10.0-alpha] - 2026-03-14

### Added

- Model display name mapping and MAX effort easter egg
- Align ask-question types with SDK and add preview/notes support
- LaTeX math rendering support
- Input placeholder with provider name and usage hints
- SET_FAST_MODE IPC handler

### Fixed

- Timestamp-based scroll intent to fix trackpad auto-scroll race condition
- Encode local-file URLs to prevent unwanted decoding of percent characters
- Show subagent summary after task completion
- Improve SDK event handling for replay and subagent

## [0.9.0-alpha] - 2026-03-14

### Added

- Live bash output streaming, rate limit indicator, and git status refactor
- Edit/Write diff preview in permission prompt
- ULTRATHINK easter egg for high thinking effort
- Link safety modal for external URLs
- Cmd+N shortcut to create new session

### Fixed

- Eliminate startup flash and improve loading transitions
- Suppress overlay for /compact slash command output
- Convert streaming status to interrupted on session save
- Move sidebar toggle to main header on Windows
- Auto-hide scrollbars, only show while scrolling

### Performance

- Reduce store subscription overhead for typing and streaming

## [0.8.5-alpha] - 2026-03-14

### Fixed

- `local-file://` protocol URL for Windows drive letter paths

## [0.8.4-alpha] - 2026-03-14

### Fixed

- Include `cache_creation_input_tokens` in usage tracking
- Normalize path separators for Windows compatibility
- Update plan mode placeholder and fix option text truncation

## [0.8.3-alpha] - 2026-03-14

### Fixed

- Use platform separator in path validation and skill install

## [0.8.2-alpha] - 2026-03-14

### Fixed

- Use platform path separator in `isPathWithinAllowed` (security)

## [0.8.1-alpha] - 2026-03-13

### Added

- ReviewPanel for interactive code review and git log IPC
- Overhaul minimap scroll, optimize DiffView, fix external file preview

### Fixed

- Session isolation, restore, and reset for Codex sessions
- Remove unnecessary keyDown handler from ReviewPanel search input
- Allow hidden files in mention search, hide completed codex todos

### Refactored

- Expand EXCLUDED_DIRS with common build/cache directories

## [0.8.0-alpha] - 2026-03-13

### Added

- Codex integration: isolated sessions, worktree cwd support
- Plan item UI and collaboration mode
- Route tool/requestUserInput through ask_user_question flow
- Cancel decision in permission flow, upgrade codex-sdk to 0.114.0

### Refactored

- Extract TodoListPanel and unify codex todo display

### Tests

- Codex experiment service unit tests

## [0.7.4-alpha] - 2026-03-12

### Fixed

- Accumulate subagent input tokens instead of overwriting
- Defer session eviction until DB save completes

### Refactored

- Move cwd to per-session state and unify resume logic

## [0.7.3-alpha] - 2026-03-11

### Added

- Improved sandbox permission request UI

### Fixed

- Scrollable project list in ProjectSelector dropdown
- Isolate worktree path per session and detect removed worktrees
- Handle raw bash input parsing and preserve background task completed state
- Prevent programmatic scroll from disabling auto-scroll
- Make entire reasoning block header clickable for expand/collapse
- Clear pending worktree state when switching to local session

## [0.7.2-alpha] - 2026-03-11

### Added

- Move support for external drops and improved drag-drop UX in file tree
- rootPath support for multi-root workspaces in search

### Fixed

- Use inset ring for drag-over highlight to prevent clipping

### Tests

- Permission queue and deduplication tests

## [0.7.1-alpha] - 2026-03-11

### Fixed

- Use inset ring for drag-over highlight to prevent clipping

## [0.7.0-alpha] - 2026-03-11

### Added

- File operations with drag-and-drop support in file tree
- Fuzzy file search IPC for @mention popup
- Fuzzy search for slash commands

## [0.6.1-alpha] - 2026-03-10

### Fixed

- Queue concurrent permission requests instead of overwriting

## [0.6.0-alpha] - 2026-03-10

### Added

- Clickable FileChip in read tool and markdown file links for Codex
- Granular usage tracking, steer routing, and model caching for Codex
- Upgrade Codex SDK to 0.112.0 with commandActions parsing

### Fixed

- Prevent layout shifts from breaking auto-scroll during streaming
- Accumulate input tokens across multi-step turns

### Refactored

- Extract CopyableMarkdown and ReasoningBlock components

## [0.5.4-alpha] - 2026-03-09

### Fixed

- Pass SDK CLI path in CONNECT_CLAUDE query for Windows

## [0.5.3-alpha] - 2026-03-09

### Added

- Remote control settings page, store, and sonner toast
- Secure two-phase pairing with paired devices persistence
- Per-agent config and multi-agent activation support

### Fixed

- Skip session rename on Enter during IME composition
- Wrong OpenRouter icon for DMXAPI/PackyCode and remove redundant badge

### Refactored

- Remove typewriter animation from CodexTurnView

## [0.5.2-alpha] - 2026-03-05

### Fixed

- Pass SDK CLI path to query() for packaged app asar support

## [0.5.1-alpha] - 2026-03-05

### Fixed

- Use SDK bundled CLI instead of system Claude Code

## [0.5.0-alpha] - 2026-03-05

### Added

- Provider management with model mapping and preset configs

### Fixed

- Upgrade codex-sdk to 0.107.0 and fix IME/scroll issues

### Tests

- Provider env mapping, env injection, and maskApiKey tests

## [0.4.2-alpha] - 2026-03-04

### Fixed

- Tool block overflow and denied feedback layout
- Text overflow in user message bubbles

### Refactored

- Consolidate markdown rendering into MarkdownView component

## [0.4.1-alpha] - 2026-03-03

### Fixed

- Defer GH_TOKEN cleanup to avoid updater race condition

## [0.4.0-alpha] - 2026-03-03

### Added

- Inline activity panels, background task collapse, and async agent output
- Rebuild session when switching to/from bypassPermissions mode

### Fixed

- Validate HEAD before branch creation and case-insensitive branch name matching

## [0.3.2-alpha] - 2026-03-02

### Added

- Dismissible rate limit indicator with absolute reset time
- Deferred session resume with awaitingAssistantReply state
- Link safety modal for external URLs
- Click file chip to open file in panel
- Batch session cleanup by time period

### Fixed

- Error handling and startup diagnostics
- Cross-platform Codex runtime detection with system CLI fallback
- Guard disposed bridge and handle pre-ID session parking
- Long text overflow in user messages
- Scope GH_TOKEN to update check duration
- Respect upward scroll during streaming
- Use latest step input tokens instead of accumulating
- Prevent worktree state from polluting non-worktree sessions

## [0.3.0-alpha] - 2026-03-01

### Added

- Path-security module and hardened IPC handlers
- Improved subagent rendering, session history, and store event handling
- Session hide, paginated listing, and improved error logging
- Event trace infrastructure for debugging data flow
- Session context menu with hover icons replacing dropdown
- Prompt prefire to queue messages during streaming

### Fixed

- Sync turnMessageId for slash commands without assistant messages
- Route new-turn content to correct messageId during background tasks
- Auto-scroll input to cursor on new line insertion

## [0.2.2-alpha] - 2026-02-28

### Fixed

- Use strict NODE_ENV check for raw session logging

## [0.2.1-alpha] - 2026-02-28

### Fixed

- Handle local_command_output system messages and add raw session logging
- Preserve leading whitespace in git status output
- Improve denied tool border, minimap diff contrast, and file preview markdown

## [0.2.0-alpha] - 2026-02-28

### Added

- Cmd+N shortcut to create new session
- Live bash output streaming, rate limit indicator, and git status refactor
- Dedicated Kbd component replacing CommandShortcut

### Fixed

- Worktree indicator incorrectly shown on normal sessions
- Expand bash tool block during execution and improve tool UI
- Auto-clamp panels on window resize and fix diff view min-height
- Show preparing state during blockmap phase and allow dismiss

### Tests

- Unit tests for git-status-utils, ansi parser, and tool-block-utils

## [0.1.0-alpha.4] - 2026-02-27

### Added

- PDF zoom controls, URL source support, and responsive scaling
- File preview support for images, PDF, SVG, video, and audio

## [0.1.0-alpha.3] - 2026-02-27

Initial tagged release.

## [0.1.0-alpha.2] - 2026-02-27

### Fixed

- Theme-aware syntax highlighting in diff view
- Light mode support for subagent type badge
- Rename explorer to files and fix file tree race condition

### Refactored

- Use applyDefaultModel helper for session model init

## [0.1.0-alpha.1] - 2026-02-27

Initial alpha release of SuperOne.
