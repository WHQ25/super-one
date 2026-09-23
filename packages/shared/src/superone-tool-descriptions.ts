/** Agent-facing text shared by desktop registrations and remote Host Actions. */
export const MANUAL_READ_DESCRIPTION =
  "Read SuperOne documentation for the task at hand. Omit domain for the catalog, pass domain for its topic index, or domain + topic for one manual. For widget, use topic or modules. Reuse relevant guidance already read in this session. Use config_read for live settings and widget_list_templates for saved widgets."

export const MINIAPP_GUIDE_TOPIC_DESCRIPTION =
  "Use overview for a new mini-app; read API, tools, or packaging topics only when the task needs them."

export const SETUP_MINI_APP_DEV_DESCRIPTION =
  "Scaffold and register a new mini-app. Read miniapp/overview for architecture and scope. Use the requested requirements and choose suitable template and directory defaults; ask only about unresolved choices that change the app or its visibility. Creates source files, a dev registry entry, and a scoped .s1-dev.json pointer. For existing source use miniapp_dev_register."

export const REGISTER_DEV_MINIAPP_DESCRIPTION =
  'Register an existing mini-app directory without modifying its source files. ' +
  'Reads manifest.json from the directory or dist, updates dev-registry.json in the variant-specific personal data root, and optionally writes a project- or user-scoped .s1-dev.json pointer.'

export const PACK_MINI_APP_DESCRIPTION =
  'Package a mini-app directory into a .s1app file for distribution. The app directory must contain a valid manifest.json with a version field. Generates integrity checksums and creates a compressed archive.'

export const UPDATE_SUPERONE_TYPES_DESCRIPTION =
  'Update the superone.d.ts type definitions in an existing mini-app project to the latest version. Use this when the mini-app needs access to newly added SuperOne APIs.'

export const RENAME_SESSION_DESCRIPTION =
  'Rename the current chat session to a concise topic label shown in the sidebar. ' +
  'Always pass tags (set): 1–4 short kebab-case labels you choose so session_list/session_search can find this chat. ' +
  'Reuse names from session_tag_list when they fit; invent one when they don\'t. ' +
  'When the session fixes an issue, reviews a PR, or opens one, add a ref tag issue-N / pr-N on top of the labels. ' +
  // The user_locked recovery path is not described here: the error reply itself already
  // says "Do not call session_rename again for this session", so spelling it out in the
  // always-loaded surface charged every turn for advice only one reply ever needs.
  'Top-level agent only — a Task/subagent worker does not own the user-facing title and must not call it.'

export const SESSION_TAG_DESCRIPTION =
  'Tag SuperOne sessions so session_list/session_search can filter by tag. Default: current session. ' +
  'Pass sessionId for one other session, or sessionIds with add to tag many. Use add, remove, or set (exactly one). set: [] clears. ' +
  'Pick 1–4 short kebab-case labels; reuse names from session_tag_list when they fit, otherwise invent. ' +
  'Add pr-N as soon as the session opens a PR, and issue-N / pr-N when work turns out to target one. ' +
  'Only the top-level agent may call this; subagents must not. Not session_rename (titles) and not live collab.'

export const SESSION_TAG_LIST_DESCRIPTION =
  "List session tags and counts. Default: current project; projectId or allProjects changes scope. kind: label (default) = topic labels to reuse; ref = issue-N / pr-N tracker references; all = both. Use query for a tag substring. Discover unknown label tags here before filtering session_list/session_search; reuse known tags, and a known ref tag (pr-456) needs no lookup. Filter with tagMatch any or all. Hidden sessions are omitted unless includeHidden."

export const PROJECT_LIST_DESCRIPTION =
  'List SuperOne projects (id, name, path, lastActiveAt). ' +
  'Call this to discover projectId before session_list/session_search with projectId. ' +
  'Default order is last-active desc. Filter with query (name/path substring). ' +
  'isCurrent marks the project of the calling session.'

export const SESSION_LIST_DESCRIPTION =
  "List saved SuperOne session metadata. Default: current project; pass projectId or allProjects for another scope. Filter by title, harness, dates, tags, or pin/hidden state. Use session_read for a transcript, session_search for message text, and project_list for project paths. Does not resume a harness or connect live collaboration."

export const SESSION_SEARCH_DESCRIPTION =
  'Search SuperOne chat transcripts by text (title + message body). Default: current project; projectId or allProjects for cross-project. ' +
  'Optional tags + tagMatch (any/all, default any) narrows sessions in SQL before scanning messages. Discover tags with session_tag_list. ' +
  'Returns matching message hits with short snippets and projectId. Then call session_read with sessionId/messageId. Snippets are pointers only — not full bodies.'

export const SESSION_READ_DESCRIPTION =
  "Read a saved transcript by sessionId without resuming its harness. Choose the view needed: meta, user, assistant, text, tools (index), or tool_detail (requires toolUseId). Paginate with limit/cursor; anchor with messageId/around. Read current-session history only when needed content is absent from context, such as after compaction."

export const SESSION_TAGS_FILTER_DESCRIPTION =
  'Tags from session_tag_list. Filter sessions that have these labels.'

export const SESSION_TAG_MATCH_DESCRIPTION =
  'any = at least one listed tag (default). all = every listed tag. Ignored when tags is omitted.'

export const SESSION_CLEANUP_DESCRIPTION =
  'Hide, unhide, or delete SuperOne sessions by id (from session_list; ids may be from any project). ' +
  'hide/unhide need no confirmation. delete always opens a user confirmation dialog. ' +
  'Never deletes the current session; skips pinned unless includePinned. Prefer session_list to choose ids first.'

export const CONFIG_READ_DESCRIPTION =
  'Read live SuperOne settings and their field schema. Always call this before config_apply. ' +
  'Omit domain to list settings and resource domains; pass domain to read exact keys, current values, and constraints. ' +
  'For resource domains, pass recordId to read one record before updating or deleting it. Use read_manual for documentation.'

export const CONFIG_APPLY_DESCRIPTION =
  'Propose a settings change or resource create/update/delete using keys returned by config_read. ' +
  'Pass exactly one of changes or resource. Every call opens an editable confirmation dialog and applies nothing without user approval. ' +
  'For updates, send only changed fields. Stop on cancelled or error; on rejected, use the returned feedback before retrying.'

export const MEDIA_GUIDE_TOPIC_DESCRIPTION =
  "Choose the provider-task topic from media_list_providers.kind and the requested media type; overview explains shared fields and routing."

export const LIST_MEDIA_PROVIDERS_DESCRIPTION =
  'List configured media providers that have usable credentials. Filter by image or video. ' +
  'Use a returned provider id with media_generate_image or media_generate_video; use kind to select the matching media manual topic. ' +
  'Honor returned sizing and sizeNote constraints.'

export const GENERATE_IMAGE_DESCRIPTION =
  "Generate or edit an image; pass source files in reference_image_paths for edits. Discover configured providers with media_list_providers when not already known. Read the matching media provider-task topic for unfamiliar options. Inspect previewPaths; savedPaths holds originals for export or edits. Check warnings for ignored options. Results display automatically; do not embed them again."

export const GENERATE_VIDEO_DESCRIPTION =
  "Submit a video generation; the tool opens a parameter review for user approval. Stop on cancelled or error; use returned feedback before retrying. Poll media_video_status about every 30s until generated or error. Results display automatically. Use media_list_providers for configured providers and the matching media provider-task manual for unfamiliar options."

export const VIDEO_STATUS_DESCRIPTION =
  "Advance a submitted video job and read its status: running, generated with savedPaths, or error with message. Poll about every 30 seconds while running: these calls download and save the completed video. Report it ready only after generated; stop on error."

export const SESSION_LIST_AGENTS_DESCRIPTION =
  'List the agent profiles available for user-approved child sessions. Only launchable agents are returned. ' +
  'Inspect each profile\'s harness and defaultConfig before session_collab_request. ' +
  'You may reuse one agentId for multiple launches. ' +
  'Skip this call when the user already named an agent with @ — that mention carries its agentId.'

export const SESSION_REQUEST_AGENTS_DESCRIPTION =
  'Request user approval for collaboration launches. See the mode field for spawn vs handoff vs link. ' +
  'Spawn/handoff: pick an agentId from session_collab_list_agents; require name, role, summary, task. Link: require sessionId + summary. ' +
  'Read read_manual({ domain: "product", topic: "collaboration" }) before the first launch in a session. ' +
  'User must approve; returns the credential for session_collab_start.'

export const LAUNCH_SUMMARY_DESCRIPTION =
  'Short 2–3 sentence task summary shown collapsed in the confirm dialog. Not the full brief — put detail in task.'

export const LAUNCH_TASK_DESCRIPTION =
  'Full Markdown brief. Spawn/handoff: delivered to the new session on session_collab_start. ' +
  'A handoff receiver cannot ask you anything back, so make the brief self-contained. ' +
  'Link: optional opening for the peer (mailbox + turn wake, never system prompt). Expandable in the confirm UI.'

export const LAUNCH_MODE_DESCRIPTION =
  '"spawn" (default) = nested child with a two-way mailbox. ' +
  '"handoff" = top-level sibling, not nested: it owns the task from then on, with no mailbox and no reply — pass work forward rather than supervise it. ' +
  '"link" = connect to an existing session (sessionId required).'

export const LAUNCH_SESSION_ID_DESCRIPTION =
  'Existing SuperOne session id to link with (mode "link" only). Required for link; ignore for spawn. Prefer ids from @session mentions or session_list — never invent ids.'

/**
 * Field-level guidance, not part of the tool description: `session_collab_request`
 * has a 700-char description budget. Field hints belong in the schema;
 * whether schemas load eagerly or on demand depends on the harness.
 * Both registration surfaces (JSON Schema for the Codex stdio bridge, Zod for the
 * in-process Claude server) must carry it — see superone-mcp-builtin-defs.test.ts.
 *
 * Long worktree/cwd recipes live in product/collaboration via read_manual — keep
 * field blurbs short and point there.
 */
export const LAUNCH_PERMISSION_MODE_DESCRIPTION =
  'How autonomous the child session is. Nobody watches a child, so prefer the most autonomous mode it can finish under; "plan"/"default" only when stopping for human review is the point. ' +
  'Per-harness mode names, and why requesting autonomy is safe here: See read_manual({ domain: "product", topic: "collaboration" }).'

export const LAUNCH_CWD_DESCRIPTION =
  'Only for a genuinely different project root; omit for the current project. ' +
  'Never a same-repo worktree leaf — express isolation with config.worktree. ' +
  'See read_manual({ domain: "product", topic: "collaboration" }).'

export const LAUNCH_WORKTREE_DESCRIPTION =
  'Host-managed worktree for same-repo isolation; leave cwd unset. ' +
  'For parallel implementers, not for read-only review of the shared checkout. ' +
  'See read_manual({ domain: "product", topic: "collaboration" }).'

export const LAUNCH_BRANCH_NAME_DESCRIPTION =
  'With mode "branch", create this unique branch. Git cannot check out one branch in two worktrees.'

export const SESSION_START_DESCRIPTION =
  'Activate one approved collaboration credential. Spawn: create the child and deliver its task. ' +
  'Handoff: create the sibling session and deliver the task; the credential is spent, no mailbox follows. ' +
  'Link: bind the existing peer and wake it via turn injection (not system prompt). ' +
  'Returns the peer sessionId once it begins or is notified; message it with session_collab_send. ' +
  'Retries are idempotent. Start all credentials back-to-back.'

export const SESSION_SEND_DESCRIPTION =
  'Send a persistent Markdown message to a collaboration peer: your spawn parent or child, or a linked session. ' +
  'The host checks that you may message that session. Use clientMessageId for retry-safe delivery. ' +
  'The host wakes the peer and later wakes you when it replies. ' +
  'After sending, continue other work or end your turn. Never sleep, resend, or poll session_collab_retrieve while waiting.'

export const SESSION_SEND_TO_DESCRIPTION =
  'Peer session id. Omit only when you have exactly one peer (a spawn child always does: its parent). ' +
  'session_collab_retrieve lists your peers.'

export const SESSION_SEND_CONTENT_DESCRIPTION =
  'Mailbox message body in Markdown. Prefer structured Markdown (headings, lists, code fences) for agent-to-agent handoffs; ' +
  'the SuperOne UI renders it as a Markdown preview.'

export const SESSION_RETRIEVE_DESCRIPTION =
  'Read queued Markdown messages from your collaboration peers and list those peers (session id, name, relation). ' +
  'Call after a collaboration wake, before acting on peer input, or to find out who you can message. ' +
  'This is a non-blocking read: status "empty" is not a retry signal. Do not sleep or poll; end your turn and wait for the next wake.'

export const SESSION_RETRIEVE_FROM_DESCRIPTION =
  'Only read messages from these peer session ids. Omit to read from every peer.'

export const AUTOMATION_LIST_DESCRIPTION =
  "List project automations with schedule and last/next run. Pass id for full prompt, agentConfig, and schedule; filter by query or enabled. Find unknown ids here before automation_apply or automation_delete; check for duplicates before creation when needed."

export const AUTOMATION_APPLY_DESCRIPTION =
  'Create or update a project automation. create needs name, prompt, schedule; update needs id plus any field (pause via enabled=false). ' +
  'Call automation_list first for ids; remove with automation_delete. Always opens a user confirmation dialog and applies nothing without approval. ' +
  'For schedule and agentConfig shapes see read_manual({ domain: "product", topic: "automation" }).'

export const AUTOMATION_DELETE_DESCRIPTION =
  'Permanently delete project automations by id (from automation_list). ' +
  'Always opens a user confirmation dialog. Current project only. Prefer automation_list to choose ids first.'


export const TERMINAL_TABS_DESCRIPTION =
  'Only for commands that run until stopped (servers, watchers) or need keyboard input (REPLs, TUIs, ssh, wizards). ' +
  'Non-interactive commands that finish (build, test, install, git) use your shell tool, even if slow. ' +
  'action=list (default) returns this session\'s tabs plus the user\'s as a TOON table; other sessions\' tabs are hidden. ' +
  'action=run asks to approve `command`, types it into a new or idle tab, and returns the screen; you control the tab only while that command is in the foreground. ' +
  'action=attach asks to control a command already running in a user tab. ' +
  'action=close kills a tab you opened, never one the user is using. For open tabs: terminal_act / terminal_wait_for / terminal_snapshot.'

export const TERMINAL_SNAPSHOT_DESCRIPTION =
  'Read a terminal tab as rendered text. `include` picks sections: screen (visible rows, default), scrollback (last `tail` lines including scrolled-off output), cursor, meta (title, cwd, status, foreground command, control). ' +
  'Use screen for prompts and full-screen programs, scrollback for server logs. Output over the tail cap is spilled to a file and returned as path + preview. ' +
  'Prefer this before terminal_act; use terminal_wait_for instead of polling.'

export const TERMINAL_ACT_DESCRIPTION =
  'Send input to a terminal tab you control. actions is an array, e.g. [{type:"type",text:"yes"}] or [{type:"key",key:"Ctrl+C"}]; types: type (Enter by default), key (Enter, Tab, Escape, Up, Ctrl+C, F1…), raw, resize, wait. ' +
  'ONE action per call by default; batch 2–20 only for an uninterruptible sequence (answer a wizard). Fail-fast. ' +
  'expect holds the call open until a screen condition is met (text, textGone, idleMs, exited); the screen after the batch is returned. ' +
  'Rejected with status=rejected when the approved command has exited or the user took over — do not retry, call terminal_tabs run again or ask. ' +
  'description is shown to the user instead of raw keystrokes.'

export const TERMINAL_WAIT_FOR_DESCRIPTION =
  'Block until a terminal tab reaches a state; conditions AND-combine: text (substring visible on screen or in new output), textGone, idleMs (no output for that long), exited (foreground command finished). ' +
  'Use after terminal_tabs run or terminal_act when output arrives asynchronously (a server banner, a watch rebuild finishing). timeoutMs default 15000, max 120000. Do not sleep+poll with terminal_snapshot yourself.'
