import { mockIpc } from '../../../../../.storybook/mock-ipc'

/** External boundaries shared by transcript stories; production stores stay real. */
export function mockTranscriptIpc(): void {
  mockIpc('app', 'resumeSession', async () => null)
  mockIpc('app', 'getMediaServerPort', async () => 6007)
  mockIpc('app', 'getModelCatalog', async () => ({ providers: [] }))
  mockIpc('app', 'getScheduledSend', async () => null)
  mockIpc('app', 'getStartupData', async () => ({ cached: {} }))
  mockIpc('app', 'getMcpMetaCache', async () => ({}))
  mockIpc('app', 'getGitBranch', async () => null)
  mockIpc('app', 'resolveFavicon', async () => null)
  for (const method of ['trace', 'probeMcpIcons']) mockIpc('app', method, async () => undefined)
  mockIpc('app', 'getAppSettings', async () => ({ agentPreference: { claude: { drawModInterfaces: false } } }))
  mockIpc('app', 'connectClaude', async () => ({ models: [], account: {}, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [] }))
  mockIpc('app', 'collaborationMailbox', Object.assign(() => {}, { list: async () => [], onChanged: () => () => {} }))
  for (const method of [
    'listPlatforms', 'listCredentials', 'listBindings', 'claudeListAccounts',
    'listMcpLibrary', 'listInstalledMcpb', 'listHarnesses', 'queryHarnessSessionRanks',
    'codexListAccounts',
  ]) mockIpc('app', method, async () => [])
  const resources = { agents: [], selectedAgentId: null, modelsByAgentId: {}, configByAgentId: {} }
  for (const method of ['listAcpAgents', 'refreshAcpModels']) mockIpc('app', method, async () => resources)
}
