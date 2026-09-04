import { create } from 'zustand'
import type { AgentInfo, HookConfig, HookSavePayload, MarketplacePlugin, MarketplacePluginDetail, MarketplaceScope, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, PluginDetail, PluginInfo, ResourceScope, SkillDetail, SkillInfo } from '@superone/shared/agent-types'
import type { ConsumerBinding, ConsumerId, Credential, Platform } from '@superone/shared/platform-registry'
import type { McpbInstalledEntry } from '@superone/shared/mcpb-types'
import { useAppStore } from './app'
import { useChatStore } from './chat'
import {
  deleteMcpConfigForProject,
  deleteSkillForProject,
  fetchMcpConfigsForProject,
  fetchSkillsForProject,
  getSkillForProject,
  getWindowEnvironmentApi,
  isRemoteProjectPath,
  readSkillFileForProject,
  saveMcpConfigForProject,
  toggleMcpConfigForProject,
} from '@/lib/remote-resource-ops'

/** Get the active project path. Returns empty string if none active. */
function getProjectPath(): string {
  return useAppStore.getState().currentFolder ?? ''
}

function settingsProvider(): 'claude' | 'codex' | 'dsh' {
  const provider = useAppStore.getState().settingsProvider
  return provider === 'codex' || provider === 'dsh' ? provider : 'claude'
}

interface SettingsState {
  // Agents
  agents: (AgentInfo & { scope: 'user' | 'project' })[]
  agentContent: string | null
  agentContentName: string | null
  fetchAgents: () => Promise<void>
  readAgentFile: (name: string) => Promise<void>
  clearAgentDetail: () => void

  // Skills
  skills: SkillInfo[]
  skillDetail: SkillDetail | null
  skillFileContent: string | null
  skillFilePath: string | null
  disabledSkills: string[]
  fetchSkills: () => Promise<void>
  readSkill: (name: string, sourcePath?: string) => Promise<void>
  readSkillFile: (skillName: string, relativePath: string, sourcePath?: string) => Promise<void>
  clearSkillDetail: () => void
  installSkill: (sourcePath: string) => Promise<void>
  deleteSkill: (skill: SkillInfo) => Promise<void>
  loadDisabledSkills: () => Promise<void>
  toggleSkill: (name: string, disabled: boolean) => Promise<void>

  // Codex Skills (reuses skills/skillDetail/skillFileContent/skillFilePath state)
  fetchCodexSkills: () => Promise<void>
  readCodexSkill: (name: string, sourcePath?: string) => Promise<void>
  readCodexSkillFile: (skillName: string, relativePath: string, sourcePath?: string) => Promise<void>

  // MCP
  mcpConfigs: McpServerConfig[]
  mcpStatus: McpServerInfo[]
  mcpMeta: Record<string, McpServerMeta>
  selectedMcpName: string | null
  fetchMcpConfigs: () => Promise<void>
  checkMcpServers: () => Promise<void>
  saveMcpConfig: (name: string, config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>, scope: ResourceScope) => Promise<void>
  deleteMcpConfig: (name: string, scope: ResourceScope) => Promise<void>
  toggleMcpConfig: (name: string, disabled: boolean, scope: ResourceScope) => Promise<void>
  selectMcp: (name: string | null) => void

  // Codex MCP config (separate field — read-only)
  codexMcpConfigs: McpServerConfig[]
  codexMcpStatus: McpServerInfo[]
  fetchCodexMcpConfigs: () => Promise<void>
  fetchCodexMcpStatus: (serverName?: string) => Promise<void>

  // dsh MCP config
  dshMcpConfigs: McpServerConfig[]
  fetchDshMcpConfigs: () => Promise<void>

  // MCP library
  mcpLibrary: McpLibraryEntry[]
  fetchMcpLibrary: () => Promise<void>
  deleteMcpLibraryEntry: (name: string) => Promise<void>

  // MCP bundles (.mcpb)
  mcpbInstalled: McpbInstalledEntry[]
  fetchMcpbInstalled: () => Promise<void>
  uninstallMcpb: (name: string) => Promise<void>
  revealMcpb: (name: string) => Promise<void>

  // Unified AI provider platform (registry + credentials + bindings)
  platforms: Platform[]
  credentials: Credential[]
  bindings: ConsumerBinding[]
  /**
   * Where credentials CRUD reads/writes.
   * `local` = desktop SQLite; otherwise a remote connection id (node store).
   */
  providerScope: 'local' | string
  setProviderScope: (scope: 'local' | string) => void
  fetchProviderData: () => Promise<void>
  createCredential: (input: Parameters<typeof window.app.createCredential>[0]) => Promise<Credential>
  updateCredential: (id: string, patch: Parameters<typeof window.app.updateCredential>[1]) => Promise<void>
  deleteCredential: (id: string) => Promise<void>
  createCustomPlatform: (def: Platform) => Promise<Platform>
  updateCustomPlatform: (def: Platform) => Promise<void>
  deleteCustomPlatform: (id: string) => Promise<void>
  setBinding: (binding: ConsumerBinding) => Promise<void>
  clearBinding: (consumer: ConsumerId) => Promise<void>
  /** Push desktop credentials → selected remote node (Main decrypts secrets). */
  pushProvidersToRemote: (opts?: { replaceAll?: boolean }) => Promise<{ credentials: number; bindings: number }>
  /** Pull remote node credentials → desktop. */
  pullProvidersFromRemote: (opts?: { replaceAll?: boolean }) => Promise<{ credentials: number; bindings: number }>

  // Plugins
  plugins: PluginInfo[]
  pluginsLoading: boolean
  pluginDetail: PluginDetail | null
  pluginFileContent: string | null
  pluginFilePath: string | null
  marketplacePlugins: MarketplacePlugin[]
  marketplacePluginDetail: MarketplacePluginDetail | null
  marketplacePluginFileContent: string | null
  marketplacePluginFilePath: string | null
  reloadPlugins: () => Promise<void>
  fetchPlugins: () => Promise<void>
  readPlugin: (key: string) => Promise<void>
  readPluginFile: (pluginKey: string, relativePath: string) => Promise<void>
  clearPluginDetail: () => void
  deletePlugin: (key: string, scope: ResourceScope) => Promise<void>
  fetchMarketplacePlugins: () => Promise<void>
  installPlugin: (key: string, scope: ResourceScope) => Promise<void>
  readMarketplacePlugin: (marketplace: string, name: string) => Promise<void>
  readMarketplacePluginFile: (marketplace: string, name: string, relativePath: string) => Promise<void>
  clearMarketplacePluginDetail: () => void
  addMarketplace: (source: string, scope: ResourceScope) => Promise<void>
  removeMarketplace: (name: string, scope: MarketplaceScope) => Promise<void>
  upgradeCodexMarketplace: (name?: string) => Promise<void>

  // Hooks
  hooks: HookConfig[]
  fetchHooks: () => Promise<void>
  saveHook: (payload: HookSavePayload, replaceId?: string) => Promise<void>
  deleteHook: (id: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  agents: [],
  agentContent: null,
  agentContentName: null,

  fetchAgents: async () => {
    const pp = getProjectPath()
    const agents = await window.app.listAgents(pp)
    set({ agents })
  },

  readAgentFile: async (name) => {
    const pp = getProjectPath()
    const content = await window.app.readAgentFile(pp, name)
    set({ agentContent: content, agentContentName: name })
  },

  clearAgentDetail: () => set({ agentContent: null, agentContentName: null }),

  skills: [],
  skillDetail: null,
  skillFileContent: null,
  skillFilePath: null,
  disabledSkills: [],
  mcpConfigs: [],
  mcpStatus: [],
  mcpMeta: {},
  selectedMcpName: null,
  codexMcpConfigs: [],
  codexMcpStatus: [],
  dshMcpConfigs: [],
  mcpLibrary: [],
  mcpbInstalled: [],
  platforms: [],
  credentials: [],
  bindings: [],
  providerScope: 'local',
  plugins: [],
  pluginsLoading: false,
  pluginDetail: null,
  pluginFileContent: null,
  pluginFilePath: null,
  marketplacePlugins: [],
  marketplacePluginDetail: null,
  marketplacePluginFileContent: null,
  marketplacePluginFilePath: null,
  hooks: [],

  fetchSkills: async () => {
    const pp = getProjectPath()
    const skills = await fetchSkillsForProject({
      projectPath: pp,
      provider: settingsProvider(),
      env: getWindowEnvironmentApi(),
      localListSkills: (path) => window.app.listSkills(path),
      localListCodexSkills: (path) => window.app.codexListSkills(path),
    })
    set({ skills })
  },

  readSkill: async (name, sourcePath) => {
    const pp = getProjectPath()
    const detail = await getSkillForProject({
      projectPath: pp,
      provider: settingsProvider(),
      name,
      sourcePath,
      env: getWindowEnvironmentApi(),
      localRead: (path, n, sp) => window.app.readSkill(path, n, sp),
      localCodexRead: (path, n, sp) => window.app.codexReadSkill(path, n, sp),
    })
    set({ skillDetail: detail })
  },

  readSkillFile: async (skillName, relativePath, sourcePath) => {
    const pp = getProjectPath()
    const content = await readSkillFileForProject({
      projectPath: pp,
      provider: settingsProvider(),
      skillName,
      relativePath,
      sourcePath,
      env: getWindowEnvironmentApi(),
      localRead: (path, sn, rp, sp) => window.app.readSkillFile(path, sn, rp, sp),
      localCodexRead: (path, sn, rp, sp) => window.app.codexReadSkillFile(path, sn, rp, sp),
    })
    set({ skillFileContent: content, skillFilePath: relativePath })
  },

  clearSkillDetail: () => set({ skillDetail: null, skillFileContent: null, skillFilePath: null }),

  installSkill: async (sourcePath) => {
    const pp = getProjectPath()
    // Folder-picker install packs onto the desktop host. Remote node install
    // needs a file map via skills.install — not yet exposed from the picker.
    if (isRemoteProjectPath(pp)) {
      throw new Error(
        'Installing a skill folder onto a remote project is not supported yet. ' +
          'Copy the skill onto the node filesystem or use skills.install RPC.',
      )
    }
    await window.app.installSkill(sourcePath)
    await get().fetchSkills()
  },

  deleteSkill: async (skill) => {
    const pp = getProjectPath()
    const provider = settingsProvider()
    await deleteSkillForProject({
      projectPath: pp,
      provider,
      sourcePath: skill.sourcePath,
      env: getWindowEnvironmentApi(),
      localDelete: (path, sp) => window.app.deleteSkill(path, sp),
      localCodexDelete: (path, sp) => window.app.codexDeleteSkill(path, sp),
    })
    set({ skillDetail: null, skillFileContent: null, skillFilePath: null })
    if (provider === 'codex') {
      await get().fetchCodexSkills()
    } else {
      await get().fetchSkills()
    }
  },

  loadDisabledSkills: async () => {
    const settings = await window.app.getAppSettings()
    const list = settings.agentPreference.claude.disabledSkills ?? []
    set({ disabledSkills: list })
    useChatStore.getState().setDisabledSkills(list)
  },

  toggleSkill: async (name, disabled) => {
    set((state) => ({
      disabledSkills: disabled
        ? Array.from(new Set([...state.disabledSkills, name]))
        : state.disabledSkills.filter((n) => n !== name),
    }))
    useChatStore.getState().setDisabledSkills(get().disabledSkills)
    const next = await window.app.toggleSkill(name, disabled)
    set({ disabledSkills: next })
    useChatStore.getState().setDisabledSkills(next)
  },

  // Codex Skills (reuse same state fields)
  fetchCodexSkills: async () => {
    const pp = getProjectPath()
    const skills = await fetchSkillsForProject({
      projectPath: pp,
      provider: 'codex',
      env: getWindowEnvironmentApi(),
      localListSkills: (path) => window.app.listSkills(path),
      localListCodexSkills: (path) => window.app.codexListSkills(path),
    })
    set({ skills })
  },

  readCodexSkill: async (name, sourcePath) => {
    const pp = getProjectPath()
    const detail = await getSkillForProject({
      projectPath: pp,
      provider: 'codex',
      name,
      sourcePath,
      env: getWindowEnvironmentApi(),
      localRead: (path, n, sp) => window.app.readSkill(path, n, sp),
      localCodexRead: (path, n, sp) => window.app.codexReadSkill(path, n, sp),
    })
    set({ skillDetail: detail })
  },

  readCodexSkillFile: async (skillName, relativePath, sourcePath) => {
    const pp = getProjectPath()
    const content = await readSkillFileForProject({
      projectPath: pp,
      provider: 'codex',
      skillName,
      relativePath,
      sourcePath,
      env: getWindowEnvironmentApi(),
      localRead: (path, sn, rp, sp) => window.app.readSkillFile(path, sn, rp, sp),
      localCodexRead: (path, sn, rp, sp) => window.app.codexReadSkillFile(path, sn, rp, sp),
    })
    set({ skillFileContent: content, skillFilePath: relativePath })
  },

  fetchMcpConfigs: async () => {
    const pp = getProjectPath()
    const configs = await fetchMcpConfigsForProject({
      projectPath: pp,
      provider: 'claude',
      env: getWindowEnvironmentApi(),
      localListMcp: (path) => window.app.listMcpConfigs(path),
      localListCodexMcp: (path) => window.app.codexListMcpConfigs(path),
      localListDshMcp: (path) => window.app.dshListMcpConfigs(path),
    })
    set({ mcpConfigs: configs })
  },

  checkMcpServers: async () => {
    try {
      const pp = getProjectPath()
      const result = await window.app.checkMcpServers(pp)
      set({ mcpStatus: result.status, mcpMeta: result.meta })
      await get().fetchMcpLibrary()
    } catch {
      // ignore
    }
  },

  saveMcpConfig: async (name, config, scope) => {
    const pp = getProjectPath()
    const provider = settingsProvider()
    if (provider === 'dsh' && scope !== 'user') {
      throw new Error('dsh MCP servers only support user scope')
    }
    if (scope !== 'user' && scope !== 'project') {
      // claudeai / other scopes stay local desktop-only
      if (provider === 'codex') {
        await window.app.codexSaveMcpConfig(pp, name, config, scope)
        await get().fetchCodexMcpConfigs()
        return
      }
      await window.app.saveMcpConfig(pp, name, config, scope)
      await get().fetchMcpConfigs()
      await get().checkMcpServers()
      return
    }
    await saveMcpConfigForProject({
      projectPath: pp,
      provider,
      name,
      config: config as Record<string, unknown>,
      scope,
      env: getWindowEnvironmentApi(),
      localSave: (path, n, c, s) => window.app.saveMcpConfig(path, n, c, s),
      localCodexSave: (path, n, c, s) => window.app.codexSaveMcpConfig(path, n, c, s),
      localDshSave: (path, n, c, s) => window.app.dshSaveMcpConfig(path, n, c, s),
    })
    if (provider === 'codex') {
      await get().fetchCodexMcpConfigs()
      return
    }
    if (provider === 'dsh') {
      await get().fetchDshMcpConfigs()
      return
    }
    await get().fetchMcpConfigs()
    await get().checkMcpServers()
  },

  deleteMcpConfig: async (name, scope) => {
    const pp = getProjectPath()
    const provider = settingsProvider()
    if (provider === 'dsh' && scope !== 'user') {
      throw new Error('dsh MCP servers only support user scope')
    }
    if (scope !== 'user' && scope !== 'project') {
      if (provider === 'codex') {
        await window.app.codexDeleteMcpConfig(pp, name, scope)
        set({ selectedMcpName: null })
        await get().fetchCodexMcpConfigs()
        return
      }
      await window.app.deleteMcpConfig(pp, name, scope)
      set({ selectedMcpName: null })
      await get().fetchMcpConfigs()
      await get().checkMcpServers()
      return
    }
    await deleteMcpConfigForProject({
      projectPath: pp,
      provider,
      name,
      scope,
      env: getWindowEnvironmentApi(),
      localDelete: (path, n, s) => window.app.deleteMcpConfig(path, n, s),
      localCodexDelete: (path, n, s) => window.app.codexDeleteMcpConfig(path, n, s),
      localDshDelete: (path, n, s) => window.app.dshDeleteMcpConfig(path, n, s),
    })
    set({ selectedMcpName: null })
    if (provider === 'codex') {
      await get().fetchCodexMcpConfigs()
      return
    }
    if (provider === 'dsh') {
      await get().fetchDshMcpConfigs()
      return
    }
    await get().fetchMcpConfigs()
    await get().checkMcpServers()
  },

  toggleMcpConfig: async (name, disabled, scope) => {
    const provider = settingsProvider()
    if (provider === 'dsh' && scope !== 'user') {
      throw new Error('dsh MCP servers only support user scope')
    }
    if (provider === 'codex' || provider === 'dsh') {
      set((state) => provider === 'codex'
        ? {
            codexMcpConfigs: state.codexMcpConfigs.map((c) =>
              c.name === name ? { ...c, disabled } : c
            ),
          }
        : {
            dshMcpConfigs: state.dshMcpConfigs.map((c) =>
              c.name === name ? { ...c, disabled } : c
            ),
          })
      const pp = getProjectPath()
      if (scope === 'user' || scope === 'project') {
        await toggleMcpConfigForProject({
          projectPath: pp,
          provider,
          name,
          disabled,
          scope,
          env: getWindowEnvironmentApi(),
          localToggle: (path, n, d, s) => window.app.toggleMcpConfig(path, n, d, s),
          localCodexToggle: (path, n, d, s) => window.app.codexToggleMcpConfig(path, n, d, s),
          localDshToggle: (path, n, d, s) => window.app.dshToggleMcpConfig(path, n, d, s),
        })
      } else if (provider === 'codex') {
        await window.app.codexToggleMcpConfig(pp, name, disabled, scope)
      } else {
        await window.app.dshToggleMcpConfig(pp, name, disabled, scope)
      }
      if (provider === 'codex') await get().fetchCodexMcpConfigs()
      else await get().fetchDshMcpConfigs()
      return
    }
    // Optimistic update: flip config + set pending status immediately
    set((state) => ({
      mcpConfigs: state.mcpConfigs.map((c) =>
        c.name === name ? { ...c, disabled } : c
      ),
      mcpStatus: disabled
        ? state.mcpStatus.map((s) =>
            s.name === name ? { ...s, status: 'disabled' as const } : s
          )
        : state.mcpStatus.map((s) =>
            s.name === name ? { ...s, status: 'pending' as const } : s
          ),
    }))
    const pp = getProjectPath()
    if (scope === 'user' || scope === 'project') {
      await toggleMcpConfigForProject({
        projectPath: pp,
        provider: 'claude',
        name,
        disabled,
        scope,
        env: getWindowEnvironmentApi(),
        localToggle: (path, n, d, s) => window.app.toggleMcpConfig(path, n, d, s),
        localCodexToggle: (path, n, d, s) => window.app.codexToggleMcpConfig(path, n, d, s),
        localDshToggle: (path, n, d, s) => window.app.dshToggleMcpConfig(path, n, d, s),
      })
    } else {
      await window.app.toggleMcpConfig(pp, name, disabled, scope)
    }
    await get().checkMcpServers()
  },

  selectMcp: (name) => set({ selectedMcpName: name }),

  // Codex MCP config (separate state)
  fetchCodexMcpConfigs: async () => {
    const pp = getProjectPath()
    const codexMcpConfigs = await fetchMcpConfigsForProject({
      projectPath: pp,
      provider: 'codex',
      env: getWindowEnvironmentApi(),
      localListMcp: (path) => window.app.listMcpConfigs(path),
      localListCodexMcp: (path) => window.app.codexListMcpConfigs(path),
      localListDshMcp: (path) => window.app.dshListMcpConfigs(path),
    })
    set({ codexMcpConfigs })
  },

  fetchDshMcpConfigs: async () => {
    const pp = getProjectPath()
    const dshMcpConfigs = await fetchMcpConfigsForProject({
      projectPath: pp,
      provider: 'dsh',
      env: getWindowEnvironmentApi(),
      localListMcp: (path) => window.app.listMcpConfigs(path),
      localListCodexMcp: (path) => window.app.codexListMcpConfigs(path),
      localListDshMcp: (path) => window.app.dshListMcpConfigs(path),
    })
    set({ dshMcpConfigs })
  },

  fetchCodexMcpStatus: async (serverName) => {
    try {
      const result = await window.app.codexGetMcpStatus(getProjectPath(), serverName)
      set({ codexMcpStatus: Array.isArray(result) ? result : [] })
    } catch {
      set({ codexMcpStatus: [] })
    }
  },

  fetchMcpLibrary: async () => {
    try {
      const library = await window.app.listMcpLibrary()
      set({ mcpLibrary: library })
    } catch {
      // ignore
    }
  },

  deleteMcpLibraryEntry: async (name) => {
    await window.app.deleteMcpLibraryEntry(name)
    await get().fetchMcpLibrary()
  },

  fetchMcpbInstalled: async () => {
    try {
      const installed = await window.app.listInstalledMcpb()
      set({ mcpbInstalled: installed })
    } catch {
      // ignore
    }
  },

  uninstallMcpb: async (name) => {
    await window.app.uninstallMcpb(name)
    set({ selectedMcpName: null })
    await Promise.all([get().fetchMcpbInstalled(), get().fetchMcpConfigs(), get().checkMcpServers()])
  },

  revealMcpb: async (name) => {
    await window.app.revealMcpb(name)
  },

  reloadPlugins: async () => {
    set({ pluginsLoading: true, plugins: [], marketplacePlugins: [] })
    try {
      const projectPath = getProjectPath()
      if (useAppStore.getState().settingsProvider === 'codex') {
        await window.agent.reloadPlugins(projectPath).catch(() => false)
      }
      await Promise.all([get().fetchPlugins(), get().fetchMarketplacePlugins()])
    } catch {
      void 0
    } finally {
      set({ pluginsLoading: false })
    }
  },

  fetchPlugins: async () => {
    const pp = getProjectPath()
    const provider = useAppStore.getState().settingsProvider
    const plugins = provider === 'codex'
      ? await window.app.codexListPlugins(pp)
      : await window.app.listPlugins(pp)
    set({ plugins })
  },

  readPlugin: async (key) => {
    const pp = getProjectPath()
    const provider = useAppStore.getState().settingsProvider
    const detail = provider === 'codex'
      ? await window.app.codexReadPlugin(pp, key)
      : await window.app.readPlugin(pp, key)
    set({ pluginDetail: detail })
  },

  readPluginFile: async (pluginKey, relativePath) => {
    // Virtual paths (mcp:/hooks:) are rendered from in-memory detail data — no file read.
    if (relativePath.startsWith('mcp:') || relativePath.startsWith('hooks:')) {
      set({ pluginFileContent: null, pluginFilePath: relativePath })
      return
    }
    const pp = getProjectPath()
    const provider = useAppStore.getState().settingsProvider
    const content = provider === 'codex'
      ? await window.app.codexReadPluginFile(pp, pluginKey, relativePath)
      : await window.app.readPluginFile(pp, pluginKey, relativePath)
    set({ pluginFileContent: content, pluginFilePath: relativePath })
  },

  clearPluginDetail: () => set({ pluginDetail: null, pluginFileContent: null, pluginFilePath: null }),

  deletePlugin: async (key, scope) => {
    const pp = getProjectPath()
    const provider = useAppStore.getState().settingsProvider
    if (provider === 'codex') {
      await window.app.codexDeletePlugin(pp, key, scope)
    } else {
      await window.app.deletePlugin(pp, key, scope)
    }
    set({ pluginDetail: null, pluginFileContent: null, pluginFilePath: null })
    await get().fetchPlugins()
  },

  fetchMarketplacePlugins: async () => {
    try {
      const pp = getProjectPath()
      const provider = useAppStore.getState().settingsProvider
      const marketplacePlugins = provider === 'codex'
        ? await window.app.codexListMarketplacePlugins(pp)
        : await window.app.listMarketplacePlugins(pp)
      set({ marketplacePlugins })
    } catch {
      // ignore
    }
  },

  installPlugin: async (key, scope) => {
    const pp = getProjectPath()
    const provider = useAppStore.getState().settingsProvider
    if (provider === 'codex') {
      await window.app.codexInstallPlugin(pp, key, scope)
    } else {
      await window.app.installPlugin(pp, key, scope)
    }
    await get().fetchPlugins()
    await get().fetchMarketplacePlugins()
  },

  readMarketplacePlugin: async (marketplace, name) => {
    const detail = await window.app.readMarketplacePlugin(marketplace, name)
    set({ marketplacePluginDetail: detail, marketplacePluginFileContent: null, marketplacePluginFilePath: null })
  },

  readMarketplacePluginFile: async (marketplace, name, relativePath) => {
    if (relativePath.startsWith('mcp:') || relativePath.startsWith('hooks:')) {
      set({ marketplacePluginFileContent: null, marketplacePluginFilePath: relativePath })
      return
    }
    const content = await window.app.readMarketplacePluginFile(marketplace, name, relativePath)
    set({ marketplacePluginFileContent: content, marketplacePluginFilePath: relativePath })
  },

  clearMarketplacePluginDetail: () =>
    set({ marketplacePluginDetail: null, marketplacePluginFileContent: null, marketplacePluginFilePath: null }),

  addMarketplace: async (source, scope) => {
    const pp = getProjectPath()
    if (useAppStore.getState().settingsProvider === 'codex') {
      await window.app.codexMarketplaceAdd(pp, { source })
    } else {
      await window.app.addMarketplace(source, scope, pp)
    }
    await get().fetchMarketplacePlugins()
    await get().fetchPlugins()
  },

  removeMarketplace: async (name, scope) => {
    const pp = getProjectPath()
    if (useAppStore.getState().settingsProvider === 'codex') {
      await window.app.codexMarketplaceRemove(pp, name)
    } else {
      await window.app.removeMarketplace(name, scope, pp)
    }
    await get().fetchMarketplacePlugins()
    await get().fetchPlugins()
  },

  upgradeCodexMarketplace: async (name) => {
    const pp = getProjectPath()
    await window.app.codexMarketplaceUpgrade(pp, name)
    await get().fetchMarketplacePlugins()
    await get().fetchPlugins()
  },

  setProviderScope: (scope) => {
    set({ providerScope: scope })
    void get().fetchProviderData().catch(() => {})
  },

  fetchProviderData: async () => {
    const scope = get().providerScope
    if (scope === 'local') {
      const [platforms, credentials, bindings] = await Promise.all([
        window.app.listPlatforms(),
        window.app.listCredentials(),
        window.app.listBindings(),
      ])
      set({ platforms, credentials, bindings })
      return
    }
    // Remote host may be disconnected / revoked while UI still holds the scope.
    // Never throw — callers fire-and-forget and uncaught rejections spam the console.
    try {
      const [platforms, credentials, customPlatforms, bindings] = await Promise.all([
        window.app.listPlatforms(),
        window.environment.listRemoteCredentials(scope) as Promise<Credential[]>,
        window.environment.listRemoteCustomPlatforms(scope) as Promise<Platform[]>,
        window.environment.listRemoteBindings(scope) as Promise<ConsumerBinding[]>,
      ])
      // Stale response after host switch — discard.
      if (get().providerScope !== scope) return
      const custom = Array.isArray(customPlatforms) ? customPlatforms : []
      const byId = new Map(platforms.map((p) => [p.id, p]))
      for (const p of custom) byId.set(p.id, p)
      set({
        platforms: [...byId.values()],
        credentials: Array.isArray(credentials) ? credentials : [],
        bindings: Array.isArray(bindings) ? bindings : [],
      })
    } catch (err) {
      if (get().providerScope !== scope) return
      const msg = err instanceof Error ? err.message : String(err)
      // Offline / revoked / unknown connection: show empty remote catalogs, keep local platforms.
      console.warn('[settings] fetchProviderData remote failed (%s): %s', scope, msg)
      try {
        const platforms = await window.app.listPlatforms()
        if (get().providerScope !== scope) return
        set({ platforms, credentials: [], bindings: [] })
      } catch {
        if (get().providerScope === scope) {
          set({ credentials: [], bindings: [] })
        }
      }
    }
  },

  createCredential: async (input) => {
    const scope = get().providerScope
    if (scope === 'local') {
      const created = await window.app.createCredential(input)
      await get().fetchProviderData()
      return created
    }
    const created = (await window.environment.createRemoteCredential(scope, input)) as Credential
    await get().fetchProviderData()
    return created
  },

  updateCredential: async (id, patch) => {
    const scope = get().providerScope
    if (scope === 'local') {
      await window.app.updateCredential(id, patch)
    } else {
      await window.environment.updateRemoteCredential(scope, { id, ...patch })
    }
    await get().fetchProviderData()
  },

  deleteCredential: async (id) => {
    const scope = get().providerScope
    if (scope === 'local') {
      await window.app.deleteCredential(id)
    } else {
      await window.environment.deleteRemoteCredential(scope, id)
    }
    await get().fetchProviderData()
  },

  createCustomPlatform: async (def) => {
    const scope = get().providerScope
    if (scope === 'local') {
      const created = await window.app.createCustomPlatform(def)
      await get().fetchProviderData()
      return created
    }
    const created = (await window.environment.upsertRemoteCustomPlatform(
      scope,
      def as unknown as Record<string, unknown>,
    )) as Platform
    await get().fetchProviderData()
    return created
  },

  updateCustomPlatform: async (def) => {
    const scope = get().providerScope
    if (scope === 'local') {
      await window.app.updateCustomPlatform(def)
    } else {
      await window.environment.upsertRemoteCustomPlatform(
        scope,
        def as unknown as Record<string, unknown>,
      )
    }
    await get().fetchProviderData()
  },

  deleteCustomPlatform: async (id) => {
    const scope = get().providerScope
    if (scope === 'local') {
      await window.app.deleteCustomPlatform(id)
    } else {
      await window.environment.deleteRemoteCustomPlatform(scope, id)
    }
    await get().fetchProviderData()
  },

  setBinding: async (binding) => {
    const scope = get().providerScope
    if (scope === 'local') {
      await window.app.setBinding(binding)
    } else {
      await window.environment.setRemoteBinding(scope, binding as unknown as Record<string, unknown>)
    }
    await get().fetchProviderData()
  },

  clearBinding: async (consumer) => {
    const scope = get().providerScope
    if (scope === 'local') {
      await window.app.clearBinding(consumer)
    } else {
      await window.environment.clearRemoteBinding(scope, consumer)
    }
    await get().fetchProviderData()
  },

  pushProvidersToRemote: async (opts) => {
    const scope = get().providerScope
    if (scope === 'local') throw new Error('select a remote host first')
    const result = await window.environment.pushLocalProvidersToRemote(scope, opts)
    await get().fetchProviderData()
    return result
  },

  pullProvidersFromRemote: async (opts) => {
    const scope = get().providerScope
    if (scope === 'local') throw new Error('select a remote host first')
    const result = await window.environment.pullRemoteProvidersToLocal(scope, opts)
    await get().fetchProviderData()
    return result
  },

  fetchHooks: async () => {
    const pp = getProjectPath()
    const hooks = await window.app.listHooks(pp)
    set({ hooks })
  },

  saveHook: async (payload, replaceId) => {
    const pp = getProjectPath()
    await window.app.saveHook(pp, payload, replaceId)
    await get().fetchHooks()
  },

  deleteHook: async (id) => {
    const pp = getProjectPath()
    await window.app.deleteHook(pp, id)
    await get().fetchHooks()
  },
}))
