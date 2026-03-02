import { create } from 'zustand'
import type { AgentInfo, MarketplacePlugin, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, PluginDetail, PluginInfo, ResourceScope, SkillDetail, SkillInfo } from '../../../shared/agent-types'
import { useAppStore } from './app'

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
  fetchSkills: () => Promise<void>
  readSkill: (name: string) => Promise<void>
  readSkillFile: (skillName: string, relativePath: string) => Promise<void>
  clearSkillDetail: () => void
  installSkill: (sourcePath: string) => Promise<void>
  deleteSkill: (name: string, scope: ResourceScope) => Promise<void>

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

  // Plugins
  plugins: PluginInfo[]
  pluginDetail: PluginDetail | null
  pluginFileContent: string | null
  pluginFilePath: string | null
  marketplacePlugins: MarketplacePlugin[]
  fetchPlugins: () => Promise<void>
  readPlugin: (key: string) => Promise<void>
  readPluginFile: (pluginKey: string, relativePath: string) => Promise<void>
  clearPluginDetail: () => void
  deletePlugin: (key: string, scope: ResourceScope) => Promise<void>
  fetchMarketplacePlugins: () => Promise<void>
  installPlugin: (key: string, scope: ResourceScope) => Promise<void>
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
  mcpConfigs: [],
  mcpStatus: [],
  mcpMeta: {},
  selectedMcpName: null,
  codexMcpConfigs: [],
  mcpLibrary: [],
  plugins: [],
  pluginDetail: null,
  pluginFileContent: null,
  pluginFilePath: null,
  marketplacePlugins: [],

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
    await window.app.saveMcpConfig(pp, name, config, scope)
    await get().fetchMcpConfigs()
    await get().checkMcpServers()
  },

  deleteMcpConfig: async (name, scope) => {
    const pp = getProjectPath()
    await window.app.deleteMcpConfig(pp, name, scope)
    set({ selectedMcpName: null })
    await get().fetchMcpConfigs()
    await get().checkMcpServers()
  },

  toggleMcpConfig: async (name, disabled, scope) => {
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

  fetchPlugins: async () => {
    const pp = getProjectPath()
    const plugins = await window.app.listPlugins(pp)
    set({ plugins })
  },

  readPlugin: async (key) => {
    const pp = getProjectPath()
    const detail = await window.app.readPlugin(pp, key)
    set({ pluginDetail: detail })
  },

  readPluginFile: async (pluginKey, relativePath) => {
    const pp = getProjectPath()
    const content = await window.app.readPluginFile(pp, pluginKey, relativePath)
    set({ pluginFileContent: content, pluginFilePath: relativePath })
  },

  clearPluginDetail: () => set({ pluginDetail: null, pluginFileContent: null, pluginFilePath: null }),

  deletePlugin: async (key, scope) => {
    const pp = getProjectPath()
    await window.app.deletePlugin(pp, key, scope)
    set({ pluginDetail: null, pluginFileContent: null, pluginFilePath: null })
    await get().fetchPlugins()
  },

  fetchMarketplacePlugins: async () => {
    try {
      const pp = getProjectPath()
      const marketplacePlugins = await window.app.listMarketplacePlugins(pp)
      set({ marketplacePlugins })
    } catch {
      // ignore
    }
  },

  installPlugin: async (key, scope) => {
    const pp = getProjectPath()
    await window.app.installPlugin(pp, key, scope)
    await get().fetchPlugins()
    await get().fetchMarketplacePlugins()
  },
}))
