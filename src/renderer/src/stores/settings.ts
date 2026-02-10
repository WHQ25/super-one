import { create } from 'zustand'
import type { MarketplacePlugin, McpLibraryEntry, McpServerConfig, McpServerInfo, McpServerMeta, PluginDetail, PluginInfo, ResourceScope, SkillDetail, SkillInfo } from '../../../shared/agent-types'

interface SettingsState {
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

  // MCP
  mcpConfigs: McpServerConfig[]
  mcpStatus: McpServerInfo[]
  mcpMeta: Record<string, McpServerMeta>
  selectedMcpName: string | null
  fetchMcpConfigs: () => Promise<void>
  fetchMcpStatus: () => Promise<void>
  probeMcpServers: () => Promise<void>
  saveMcpConfig: (name: string, config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>, scope: ResourceScope) => Promise<void>
  deleteMcpConfig: (name: string, scope: ResourceScope) => Promise<void>
  toggleMcpConfig: (name: string, disabled: boolean, scope: ResourceScope) => Promise<void>
  selectMcp: (name: string | null) => void
  reconnectMcpServer: (serverName: string) => Promise<void>

  // MCP library
  mcpLibrary: McpLibraryEntry[]
  fetchMcpLibrary: () => Promise<void>

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
  skills: [],
  skillDetail: null,
  skillFileContent: null,
  skillFilePath: null,
  mcpConfigs: [],
  mcpStatus: [],
  mcpMeta: {},
  selectedMcpName: null,
  mcpLibrary: [],
  plugins: [],
  pluginDetail: null,
  pluginFileContent: null,
  pluginFilePath: null,
  marketplacePlugins: [],

  fetchSkills: async () => {
    const skills = await window.app.listSkills()
    set({ skills })
  },

  readSkill: async (name) => {
    const detail = await window.app.readSkill(name)
    set({ skillDetail: detail })
  },

  readSkillFile: async (skillName, relativePath) => {
    const content = await window.app.readSkillFile(skillName, relativePath)
    set({ skillFileContent: content, skillFilePath: relativePath })
  },

  clearSkillDetail: () => set({ skillDetail: null, skillFileContent: null, skillFilePath: null }),

  installSkill: async (sourcePath) => {
    await window.app.installSkill(sourcePath)
    await get().fetchSkills()
  },

  deleteSkill: async (name, scope) => {
    await window.app.deleteSkill(name, scope)
    set({ skillDetail: null, skillFileContent: null, skillFilePath: null })
    await get().fetchSkills()
  },

  fetchMcpConfigs: async () => {
    const configs = await window.app.listMcpConfigs()
    set({ mcpConfigs: configs })
  },

  fetchMcpStatus: async () => {
    try {
      const status = await window.agent.getMcpServerStatus()
      set({ mcpStatus: status })
    } catch {
      // Session may not be active
    }
  },

  probeMcpServers: async () => {
    try {
      const meta = await window.app.probeMcpServers()
      set({ mcpMeta: meta })
      // Auto-fetch library after probe (backup happens server-side)
      await get().fetchMcpLibrary()
    } catch {
      // ignore
    }
  },

  saveMcpConfig: async (name, config, scope) => {
    await window.app.saveMcpConfig(name, config, scope)
    await get().fetchMcpConfigs()
    // Session refreshed in main process; poll status after it settles
    ;(async () => {
      await new Promise((r) => setTimeout(r, 2000))
      await get().fetchMcpStatus()
      await get().probeMcpServers()
    })()
  },

  deleteMcpConfig: async (name, scope) => {
    await window.app.deleteMcpConfig(name, scope)
    set({ selectedMcpName: null })
    await get().fetchMcpConfigs()
    // Session refreshed in main process; poll status after it settles
    ;(async () => {
      await new Promise((r) => setTimeout(r, 2000))
      await get().fetchMcpStatus()
    })()
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
    await window.app.toggleMcpConfig(name, disabled, scope)
    // Session refreshed in main process; poll status after it settles
    ;(async () => {
      await new Promise((r) => setTimeout(r, 2000))
      await get().fetchMcpStatus()
    })()
  },

  selectMcp: (name) => set({ selectedMcpName: name }),

  reconnectMcpServer: async (serverName) => {
    await window.app.reconnectMcpServer(serverName)
    await get().fetchMcpStatus()
    // Probe to pick up meta (icons, tool descriptions) if not cached
    ;(async () => {
      await get().probeMcpServers()
    })()
  },

  fetchMcpLibrary: async () => {
    try {
      const library = await window.app.listMcpLibrary()
      set({ mcpLibrary: library })
    } catch {
      // ignore
    }
  },

  fetchPlugins: async () => {
    const plugins = await window.app.listPlugins()
    set({ plugins })
  },

  readPlugin: async (key) => {
    const detail = await window.app.readPlugin(key)
    set({ pluginDetail: detail })
  },

  readPluginFile: async (pluginKey, relativePath) => {
    const content = await window.app.readPluginFile(pluginKey, relativePath)
    set({ pluginFileContent: content, pluginFilePath: relativePath })
  },

  clearPluginDetail: () => set({ pluginDetail: null, pluginFileContent: null, pluginFilePath: null }),

  deletePlugin: async (key, scope) => {
    await window.app.deletePlugin(key, scope)
    set({ pluginDetail: null, pluginFileContent: null, pluginFilePath: null })
    await get().fetchPlugins()
  },

  fetchMarketplacePlugins: async () => {
    try {
      const marketplacePlugins = await window.app.listMarketplacePlugins()
      set({ marketplacePlugins })
    } catch {
      // ignore
    }
  },

  installPlugin: async (key, scope) => {
    await window.app.installPlugin(key, scope)
    await get().fetchPlugins()
    await get().fetchMarketplacePlugins()
  },
}))
