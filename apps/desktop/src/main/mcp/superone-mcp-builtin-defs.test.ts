import { describe, expect, it } from 'vitest'
import { getDeviceAgentToolDescriptors } from '../device-agent/tools'
import { HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS } from '@superone/shared/environment/host-action-superone-descriptors'
import { classifyHostActionTool } from '@superone/shared/environment/host-action-browser-catalog'
import {
  BROWSER_TOOLS_CALL_DESCRIPTION,
  BROWSER_TOOLS_CALL_SUMMARY_DESCRIPTION,
  BROWSER_TOOLS_LIST_DESCRIPTION,
} from './browser-webmcp-tool-defs'
import {
  BUILT_IN_SUPERONE_TOOL_DEFS,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  LAUNCH_CWD_DESCRIPTION,
  LAUNCH_MODE_DESCRIPTION,
  LAUNCH_TASK_DESCRIPTION,
  LAUNCH_PERMISSION_MODE_DESCRIPTION,
  LAUNCH_WORKTREE_DESCRIPTION,
  AUTOMATION_TOOL_NAMES,
  SESSION_ARCHIVE_TOOL_NAMES,
  SESSION_COLLABORATION_TOOL_NAMES,
  SESSION_REQUEST_AGENTS_DESCRIPTION,
  SESSION_START_DESCRIPTION,
} from './superone-mcp-builtin-defs'

/**
 * A built-in tool has to be declared on two surfaces: the Zod `registerTool` calls the in-process
 * Claude SDK server uses, and these JSON-Schema descriptors the stdio bridge serves to Codex.
 * Adding a tool to one and forgetting the other is the recurring failure here — it works in one
 * harness and is silently absent in the other, with nothing failing loudly at startup.
 *
 * Browser and widget tools are the sanctioned exception: they carry their own descriptors instead
 * of a `BUILT_IN_SUPERONE_TOOL_DEFS` entry — browser tools via `getBrowserToolDescriptors()`, widget
 * tools via `registerWidgetTools()` — which both `superone-mcp-server.ts` (Claude, in-process) and
 * `superone-mcp-stdio-bridge.ts` (Codex) call directly and independently. They never round-trip
 * through the IPC-forwarding built-in tool machinery this file governs (`listSuperoneMcpTools` /
 * `executeSuperoneMcpTool`), so they don't need an entry here. In the Codex bridge specifically,
 * `registerWidgetTools()` runs before the transport connects and registers straight onto the local
 * `McpServer`, bypassing the `registeredTools` map that `refreshTools()` reconciles against — so they
 * also survive every subsequent tool-list refresh.
 */
// These carry their own descriptors (generated from zod, or hand-built) rather than
// living in BUILT_IN_SUPERONE_TOOL_DEFS. Listed explicitly so "forgot the descriptor"
// still fails for everything else.
const SEPARATELY_DESCRIBED = ['browser_', 'widget_', 'device_']

describe('built-in superone tool registration surfaces', () => {
  const describedNames = new Set(BUILT_IN_SUPERONE_TOOL_DEFS.map((def) => def.name))
  const browserTools = BUILT_IN_SUPERONE_TOOL_NAMES.filter((name) => name.startsWith('browser_'))
  const widgetTools = BUILT_IN_SUPERONE_TOOL_NAMES.filter((name) => name.startsWith('widget_'))

  it('gives every tool name a JSON-Schema descriptor for the stdio bridge', () => {
    const missing = BUILT_IN_SUPERONE_TOOL_NAMES.filter(
      (name) => !SEPARATELY_DESCRIBED.some((prefix) => name.startsWith(prefix)) && !describedNames.has(name),
    )
    expect(missing).toEqual([])
  })

  it('keeps device tools on their own descriptor path rather than silently dropping them', () => {
    // The failure this guards is invisible: a device_* name that is host-owned but
    // has no descriptor anywhere is simply missing in Codex / ACP, while Claude
    // keeps working, so nothing crashes and nobody notices.
    const deviceTools = BUILT_IN_SUPERONE_TOOL_NAMES.filter((name) => name.startsWith('device_'))
    expect(deviceTools.length).toBeGreaterThan(0)
    const described = new Set(getDeviceAgentToolDescriptors().map((def) => def.name))
    expect(deviceTools.filter((name) => !described.has(name))).toEqual([])
  })

  it('keeps remote device descriptors aligned with desktop discovery', () => {
    const desktopDescriptors = getDeviceAgentToolDescriptors()
    for (const desktop of desktopDescriptors) {
      const hostAction = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === desktop.name)
      expect(hostAction?.description, `${desktop.name} description`).toBe(desktop.description)
      expect(hostAction?.inputSchema, `${desktop.name} input schema`).toEqual(desktop.inputSchema)
      expect(desktop.description.length, `${desktop.name} description length`).toBeLessThanOrEqual(700)
    }
    expect(classifyHostActionTool('device_snapshot').replayPolicy).toBe('safe')
    expect(classifyHostActionTool('device_query').replayPolicy).toBe('safe')
    expect(classifyHostActionTool('device_wait_for').replayPolicy).toBe('safe')
    expect(classifyHostActionTool('device_act').replayPolicy).toBe('unsafe')
  })

  it('keeps WebMCP browser descriptors in the remote Host Action dump', () => {
    const list = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === 'browser_tools_list')
    const call = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === 'browser_tools_call')

    expect(list?.description).toBe(BROWSER_TOOLS_LIST_DESCRIPTION)
    expect(list?.inputSchema.required).toBeUndefined()
    expect(call?.description).toBe(BROWSER_TOOLS_CALL_DESCRIPTION)
    // `name` is deliberately optional — see browser-mcp-tools.test.ts for why.
    expect(call?.inputSchema.required).toEqual(['input'])
    // The chat row shows this summary instead of the page-author tool name, so a remote node
    // that dropped the field would silently degrade the desktop UI it feeds.
    const callProps = call?.inputSchema.properties as Record<string, { description?: string }>
    expect(callProps.description?.description).toBe(BROWSER_TOOLS_CALL_SUMMARY_DESCRIPTION)
    expect(classifyHostActionTool('browser_tools_list')).toMatchObject({
      toolGroup: 'browser.read',
      replayPolicy: 'safe',
    })
    expect(classifyHostActionTool('browser_tools_call')).toMatchObject({
      toolGroup: 'browser.act',
      replayPolicy: 'unsafe',
    })
  })

  it('does not describe a tool that is absent from the name allowlist', () => {
    const names = new Set<string>(BUILT_IN_SUPERONE_TOOL_NAMES)
    expect(BUILT_IN_SUPERONE_TOOL_DEFS.filter((def) => !names.has(def.name)).map((d) => d.name)).toEqual([])
  })

  it('keeps browser tools on their own descriptor path rather than silently dropping them', () => {
    expect(browserTools.length).toBeGreaterThan(0)
    expect(browserTools.every((name) => !describedNames.has(name))).toBe(true)
  })

  it('keeps widget tools on their own descriptor path rather than silently dropping them', () => {
    expect(widgetTools).toEqual(['widget_list_templates', 'widget_show'])
    expect(widgetTools.every((name) => !describedNames.has(name))).toBe(true)
  })

  it('gives every descriptor a usable object schema', () => {
    for (const def of BUILT_IN_SUPERONE_TOOL_DEFS) {
      expect(def.description, `${def.name} description`).toBeTruthy()
      expect(def.inputSchema.type, `${def.name} schema type`).toBe('object')
    }
  })

  it('keeps always-visible built-in descriptions concise', () => {
    for (const def of BUILT_IN_SUPERONE_TOOL_DEFS) {
      expect(def.description.length, `${def.name} description length`).toBeLessThanOrEqual(700)
      expect(def.description, `${def.name} stale tool name`).not.toMatch(
        /miniapp_dev_read_guide|media_read_guide|widget_read_guide|config_read_guide/,
      )
    }
  })

  it('exposes both video tools, since the pair is useless if either half is missing', () => {
    expect(describedNames.has('media_generate_video')).toBe(true)
    expect(describedNames.has('media_video_status')).toBe(true)

    const submit = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'media_generate_video')!
    const status = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'media_video_status')!
    expect(submit.inputSchema.required).toEqual(['prompt'])
    expect(status.inputSchema.required).toEqual(['generation_id'])
    // The submit tool returns an id, not a file, so its description must send the model to poll.
    expect(submit.description).toMatch(/media_video_status/)
  })

  // This used to assert the full autonomy guidance sat on the field, on the grounds that
  // the 700-char budget does not reach into the input schema. The budget does not, but the
  // token cost does: field descriptions are the larger half of the always-loaded surface.
  // The field now carries the decision rule and points at the manual for the rest; the mode
  // names it used to spell out are already in the enum beside it.
  it('keeps the launch autonomy rule on permissionMode and the detail in product/collaboration', () => {
    const def = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'session_collab_request')!
    const launch = (def.inputSchema.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>)
      .launches.items!.properties!
    const config = (launch.config as { properties: Record<string, { description?: string; enum?: string[] }> }).properties
    expect(config.permissionMode.description).toBe(LAUNCH_PERMISSION_MODE_DESCRIPTION)
    expect(LAUNCH_PERMISSION_MODE_DESCRIPTION).toMatch(/most autonomous mode/i)
    expect(LAUNCH_PERMISSION_MODE_DESCRIPTION).toMatch(/read_manual/)
    // Not repeated in prose — the schema already offers them.
    expect(config.permissionMode.enum).toContain('bypassPermissions')
    expect(LAUNCH_PERMISSION_MODE_DESCRIPTION).not.toMatch(/bypassPermissions/)
  })

  it('points session_collab_request at product/collaboration for worktree recipes', () => {
    expect(SESSION_REQUEST_AGENTS_DESCRIPTION).toContain(
      'read_manual({ domain: "product", topic: "collaboration" })',
    )
    // The cwd-vs-worktree rule lives on those two fields (and in the manual), not repeated here.
    expect(SESSION_REQUEST_AGENTS_DESCRIPTION.length).toBeLessThanOrEqual(700)
    const def = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'session_collab_request')!
    const launch = (def.inputSchema.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>)
      .launches.items!.properties!
    const config = (launch.config as { properties: Record<string, { description?: string }> }).properties
    expect(config.cwd.description).toMatch(/read_manual/)
    expect(config.worktree.description).toMatch(/read_manual/)
  })

  it('reserves cwd for a different project and worktree for same-repo isolation', () => {
    expect(LAUNCH_CWD_DESCRIPTION).toMatch(/different project root/i)
    expect(LAUNCH_CWD_DESCRIPTION).toMatch(/same-repo worktree leaf/i)
    expect(LAUNCH_WORKTREE_DESCRIPTION).toMatch(/same-repo isolation/i)
    expect(LAUNCH_WORKTREE_DESCRIPTION).toMatch(/leave cwd unset/i)
    expect(LAUNCH_WORKTREE_DESCRIPTION).toMatch(/not for read-only review/i)
    // `detach` guidance moved to product/collaboration — the field points there.
    expect(LAUNCH_WORKTREE_DESCRIPTION).toMatch(/read_manual/)
  })

  it('keeps collaboration host-action descriptors aligned with desktop discovery', () => {
    for (const name of SESSION_COLLABORATION_TOOL_NAMES) {
      const desktop = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === name)
      const hostAction = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === name)
      expect(hostAction?.description, `${name} description`).toBe(desktop?.description)
      expect(hostAction?.inputSchema, `${name} input schema`).toEqual(desktop?.inputSchema)
      expect(hostAction?.description.length, `${name} description length`).toBeLessThanOrEqual(700)
    }
  })

  it('points session tag tools at list/search and keeps tagMatch closed', () => {
    const tag = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'session_tag')!
    const rename = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'session_rename')!
    const list = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'session_tag_list')!
    expect(tag.description).toMatch(/session_tag_list/)
    expect(tag.description).toMatch(/subagent/i)
    expect(tag.description).toMatch(/invent/)
    expect(tag.description).not.toMatch(/do not invent/i)
    expect(rename.description).toMatch(/Always pass tags/)
    expect(rename.description).not.toMatch(/Optional tags/)
    expect(list.description).toMatch(/tagMatch/)
    expect(list.description).toMatch(/session_list/)
    const listTags = (BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'session_list')!
      .inputSchema.properties as Record<string, { enum?: string[] }>).tagMatch
    expect(listTags.enum).toEqual(['any', 'all'])
    expect(SESSION_ARCHIVE_TOOL_NAMES).toContain('session_tag')
    expect(SESSION_ARCHIVE_TOOL_NAMES).toContain('session_tag_list')
  })

  it('keeps session archive host-action descriptors aligned with desktop discovery', () => {
    for (const name of SESSION_ARCHIVE_TOOL_NAMES) {
      const desktop = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === name)
      const hostAction = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === name)
      expect(desktop, `${name} desktop def`).toBeTruthy()
      expect(hostAction?.description, `${name} description`).toBe(desktop?.description)
      expect(hostAction?.inputSchema, `${name} input schema`).toEqual(desktop?.inputSchema)
      expect(hostAction?.description.length, `${name} description length`).toBeLessThanOrEqual(700)
    }
  })

  it('keeps automation host-action descriptors aligned with desktop discovery', () => {
    for (const name of AUTOMATION_TOOL_NAMES) {
      const desktop = BUILT_IN_SUPERONE_TOOL_DEFS.find((def) => def.name === name)
      const hostAction = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((def) => def.name === name)
      expect(desktop, `${name} desktop def`).toBeTruthy()
      expect(hostAction?.description, `${name} description`).toBe(desktop?.description)
      expect(hostAction?.inputSchema, `${name} input schema`).toEqual(desktop?.inputSchema)
      expect(hostAction?.description.length, `${name} description length`).toBeLessThanOrEqual(700)
    }
  })

  it('points automation tools at each other for discovery and delete', () => {
    const list = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'automation_list')!
    const apply = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'automation_apply')!
    const del = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'automation_delete')!
    expect(list.description).toMatch(/automation_apply/)
    expect(list.description).toMatch(/automation_delete/)
    expect(apply.description).toMatch(/automation_list/)
    expect(apply.description).toMatch(/automation_delete/)
    expect(apply.description).toMatch(/confirmation dialog/)
    expect(del.description).toMatch(/automation_list/)
    expect(del.description).toMatch(/confirmation dialog/)
    expect(apply.inputSchema.required).toEqual(['action'])
    expect(del.inputSchema.required).toEqual(['ids'])
  })

  it('marks read_manual as alwaysLoad so Claude Tool Search does not hide it', () => {
    const def = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'read_manual')
    expect(def?._meta?.['anthropic/alwaysLoad']).toBe(true)
  })

  it('keeps read_manual module validation identical on the stdio descriptor', () => {
    const def = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'read_manual')!
    const modules = (def.inputSchema.properties as Record<string, Record<string, unknown>>).modules
    expect(modules).toMatchObject({ minItems: 1, uniqueItems: true })
    // `native` is not a design module — it covers handing data to a built-in SuperOne surface.
    expect(modules.items).toMatchObject({ enum: ['diagram', 'mockup', 'interactive', 'chart', 'art', 'native'] })
  })

  it('keeps the hand-maintained remote-node module enum in step with the desktop one', () => {
    // The desktop def derives from WIDGET_GUIDELINE_MODULES, but the host-action descriptor is a
    // literal copy — adding a module without updating it makes that module unusable on a remote
    // node, and nothing else would report it.
    const desktop = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'read_manual')!
    const hostAction = HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS.find((d) => d.name === 'read_manual')!
    const modulesOf = (def: typeof desktop | typeof hostAction) =>
      (def.inputSchema.properties as Record<string, Record<string, unknown>>).modules
    expect(modulesOf(hostAction).items).toEqual(modulesOf(desktop).items)
    expect(modulesOf(hostAction).maxItems).toEqual(modulesOf(desktop).maxItems)
  })

  it('restricts media provider category to supported values', () => {
    const def = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'media_list_providers')!
    const category = (def.inputSchema.properties as Record<string, Record<string, unknown>>).category
    expect(category.enum).toEqual(['image', 'video'])
  })

  it('requires summary at schema level; spawn vs link fields validated server-side', () => {
    const def = BUILT_IN_SUPERONE_TOOL_DEFS.find((d) => d.name === 'session_collab_request')!
    const launches = (def.inputSchema.properties as Record<string, Record<string, unknown>>).launches
    const item = launches.items as Record<string, unknown>
    expect(item.required).toEqual(['summary'])
    const properties = item.properties as Record<string, Record<string, unknown>>
    expect(properties.mode).toMatchObject({ enum: ['spawn', 'handoff', 'link'] })
    expect(properties.sessionId).toMatchObject({ minLength: 1 })
    expect(properties.name).toMatchObject({ minLength: 1, maxLength: 64 })
    expect(properties.role).toMatchObject({ minLength: 1, maxLength: 64 })
    expect(properties.summary).toMatchObject({ minLength: 1 })
    expect(properties.summary).not.toHaveProperty('maxLength')
    // Hard caps stay server-side; do not advertise a huge maxLength in the tool schema.
    expect(properties.task).not.toHaveProperty('maxLength')
    expect(properties.task).not.toHaveProperty('minLength')
  })

  // The three modes are named once, on the field the model fills in — the tool description
  // used to repeat them, which billed the same sentence twice on every turn.
  it('documents link + handoff modes and sessionId on the mode field', () => {
    expect(LAUNCH_MODE_DESCRIPTION).toMatch(/"link"/i)
    expect(LAUNCH_MODE_DESCRIPTION).toMatch(/"handoff"/i)
    expect(LAUNCH_MODE_DESCRIPTION).toMatch(/sessionId/)
    expect(SESSION_REQUEST_AGENTS_DESCRIPTION).toMatch(/sessionId/)
    expect(SESSION_REQUEST_AGENTS_DESCRIPTION.length).toBeLessThanOrEqual(700)
  })

  /**
   * Handoff only pays off if the model can tell it apart from spawn without the
   * manual: sibling (not nested), one-way (no mailbox), self-contained brief.
   */
  it('distinguishes handoff from spawn in the mode + task field blurbs', () => {
    expect(LAUNCH_MODE_DESCRIPTION).toMatch(/sibling/i)
    expect(LAUNCH_MODE_DESCRIPTION).toMatch(/no mailbox/i)
    expect(LAUNCH_MODE_DESCRIPTION).toMatch(/not nested/i)
    expect(LAUNCH_TASK_DESCRIPTION).toMatch(/self-contained/i)
    expect(SESSION_START_DESCRIPTION).toMatch(/handoff/i)
  })
})
