import { create } from 'zustand'
import type { AgentInfo, ApiProvider, CreateProviderRequest, HookConfig, HookSavePayload, MarketplacePlugin, MarketplacePluginDetail, MarketplaceScope, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, PluginDetail, PluginInfo, ResourceScope, SkillDetail, SkillInfo, UpdateProviderRequest } from '@superone/shared/agent-types'
import type { McpbInstalledEntry } from '@superone/shared/mcpb-types'
import { useAppStore } from './app'
import { useChatStore } from './chat'

/** Get the active project path. Returns empty string if none active. */
function getProjectPath(): string {
  return useAppStore.getState().currentFolder ?? ''
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
  readSkill: (name: string) => Promise<void>
  readSkillFile: (skillName: string, relativePath: string) => Promise<void>
  clearSkillDetail: () => void
  installSkill: (sourcePath: string) => Promise<void>
  deleteSkill: (name: string, scope: ResourceScope) => Promise<void>
  loadDisabledSkills: () => Promise<void>
  toggleSkill: (name: string, disabled: boolean) => Promise<void>

  // Codex Skills (reuses skills/skillDetail/skillFileContent/skillFilePath state)
  fetchCodexSkills: () => Promise<void>
  readCodexSkill: (name: string) => Promise<void>
  readCodexSkillFile: (skillName: string, relativePath: string) => Promise<void>

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
  fetchCodexMcpConfigs: () => Promise<void>

  // MCP library
  mcpLibrary: McpLibraryEntry[]
  fetchMcpLibrary: () => Promise<void>
  deleteMcpLibraryEntry: (name: string) => Promise<void>

  // MCP bundles (.mcpb)
  mcpbInstalled: McpbInstalledEntry[]
  fetchMcpbInstalled: () => Promise<void>
  uninstallMcpb: (name: string) => Promise<void>
  revealMcpb: (name: string) => Promise<void>

  // Providers
  providers: ApiProvider[]
  fetchProviders: () => Promise<void>
  createProvider: (data: CreateProviderRequest) => Promise<void>
  updateProvider: (id: string, data: UpdateProviderRequest) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  activateProvider: (id: string, agentType: string) => Promise<void>
  deactivateAllProviders: (agentType: string) => Promise<void>

  // Plugins
  plugins: PluginInfo[]
  pluginDetail: PluginDetail | null
  pluginFileContent: string | null
  pluginFilePath: string | null
  marketplacePlugins: MarketplacePlugin[]
  marketplacePluginDetail: MarketplacePluginDetail | null
  marketplacePluginFileContent: string | null
  marketplacePluginFilePath: string | null
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
  mcpLibrary: [],
  mcpbInstalled: [],
  providers: [],
  plugins: [],
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
    const skills = await window.app.listSkills(pp)
    set({ skills })
  },

  readSkill: async (name) => {
    const pp = getProjectPath()
    const detail = await window.app.readSkill(pp, name)
    set({ skillDetail: detail })
  },

  readSkillFile: async (skillName, relativePath) => {
    const pp = getProjectPath()
    const content = await window.app.readSkillFile(pp, skillName, relativePath)
    set({ skillFileContent: content, skillFilePath: relativePath })
  },

  clearSkillDetail: () => set({ skillDetail: null, skillFileContent: null, skillFilePath: null }),

  installSkill: async (sourcePath) => {
    await window.app.installSkill(sourcePath)
    await get().fetchSkills()
  },

  deleteSkill: async (name, scope) => {
    const pp = getProjectPath()
    const provider = useAppStore.getState().settingsProvider
    if (provider === 'codex') {
      await window.app.codexDeleteSkill(pp, name, scope)
    } else {
      await window.app.deleteSkill(pp, name, scope)
    }
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
    const skills = await window.app.codexListSkills(pp)
    set({ skills })
  },

  readCodexSkill: async (name) => {
    const pp = getProjectPath()
    const detail = await window.app.codexReadSkill(pp, name)
    set({ skillDetail: detail })
  },

  readCodexSkillFile: async (skillName, relativePath) => {
    const pp = getProjectPath()
    const content = await window.app.codexReadSkillFile(pp, skillName, relativePath)
    set({ skillFileContent: content, skillFilePath: relativePath })
  },

  fetchMcpConfigs: async () => {
    const pp = getProjectPath()
    const configs = await window.app.listMcpConfigs(pp)
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
    const provider = useAppStore.getState().settingsProvider
    if (provider === 'codex') {
      await window.app.codexSaveMcpConfig(pp, name, config, scope)
      await get().fetchCodexMcpConfigs()
      return
    }
    await window.app.saveMcpConfig(pp, name, config, scope)
    await get().fetchMcpConfigs()
    await get().checkMcpServers()
  },

  deleteMcpConfig: async (name, scope) => {
    const pp = getProjectPath()
    const provider = useAppStore.getState().settingsProvider
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
  },

  toggleMcpConfig: async (name, disabled, scope) => {
    const provider = useAppStore.getState().settingsProvider
    if (provider === 'codex') {
      set((state) => ({
        codexMcpConfigs: state.codexMcpConfigs.map((c) =>
          c.name === name ? { ...c, disabled } : c
        ),
      }))
      const pp = getProjectPath()
      await window.app.codexToggleMcpConfig(pp, name, disabled, scope)
      await get().fetchCodexMcpConfigs()
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
    await window.app.toggleMcpConfig(pp, name, disabled, scope)
    await get().checkMcpServers()
  },

  selectMcp: (name) => set({ selectedMcpName: name }),

  // Codex MCP config (read-only, separate state)
  fetchCodexMcpConfigs: async () => {
    const pp = getProjectPath()
    const codexMcpConfigs = await window.app.codexListMcpConfigs(pp)
    set({ codexMcpConfigs })
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
    await window.app.addMarketplace(source, scope, pp)
    await get().fetchMarketplacePlugins()
    await get().fetchPlugins()
  },

  removeMarketplace: async (name, scope) => {
    const pp = getProjectPath()
    await window.app.removeMarketplace(name, scope, pp)
    await get().fetchMarketplacePlugins()
    await get().fetchPlugins()
  },

  fetchProviders: async () => {
    const providers = await window.app.listProviders()
    set({ providers })
  },

  createProvider: async (data) => {
    await window.app.createProvider(data)
    await get().fetchProviders()
  },

  updateProvider: async (id, data) => {
    await window.app.updateProvider(id, data)
    await get().fetchProviders()
  },

  deleteProvider: async (id) => {
    await window.app.deleteProvider(id)
    await get().fetchProviders()
  },

  activateProvider: async (id, agentType) => {
    await window.app.activateProvider(id, agentType)
    await get().fetchProviders()
  },

  deactivateAllProviders: async (agentType) => {
    await window.app.deactivateAllProviders(agentType)
    await get().fetchProviders()
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
