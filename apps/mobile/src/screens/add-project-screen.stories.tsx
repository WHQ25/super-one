import type { ComponentProps } from 'react'
import { View } from 'react-native'
import { ADD_PROJECT_TEXT, githubRows, sourceRows } from '../add-project-state'
import { useAddProject, type AddProjectFlow } from '../navigation/use-add-project'
import { previewAddProjectRequest } from '../preview/add-project-fixtures'
import { MobileThemeProvider } from '../theme/context'
import { AddProjectScreen } from './add-project-screen'

const noop = () => {}
// Invalid inline bytes exercise the initial fallback without any live network.
const unavailableAvatar = 'data:image/png;base64,invalid'
const rows = githubRows([
  { owner: 'expo', name: 'expo', fullName: 'expo/expo', description: 'Universal native apps.', private: false, stars: 39600 },
  { owner: 'engineering-platform', name: 'internal-observability-development-tools',
    fullName: 'engineering-platform/internal-observability-development-tools',
    description: 'A long description that should truncate without squeezing out the owner initial.', private: true, stars: null },
], { ownerPrefix: null, query: '' }).map((row) => ({ ...row, avatarUrl: unavailableAvatar }))

const base: AddProjectFlow = {
  step: { kind: 'repo', source: 'github' }, title: 'Search GitHub',
  placeholder: ADD_PROJECT_TEXT.repoPlaceholderGithub, query: '', setQuery: noop,
  sections: [{ key: 'mine', label: ADD_PROJECT_TEXT.githubYourRepos, icon: 'user', rows }],
  emptyMessage: null, loading: false, busy: false, error: '', clonePreview: null,
  shallowClone: false, setShallowClone: noop, saveAsDefault: false, setSaveAsDefault: noop,
  confirmLabel: null, confirm: noop, activate: noop, canGoBack: true, goBack: noop,
}

function Preview({ flow, width = 390 }: ComponentProps<typeof AddProjectScreen> & { width?: number }) {
  return <MobileThemeProvider>
    <View style={{ width, height: 600 }}><AddProjectScreen flow={flow} /></View>
  </MobileThemeProvider>
}

export default {
  title: 'Mobile/AddProject', component: AddProjectScreen, render: Preview, args: { flow: base },
}

export const OwnerInitials = {}
export const Sources = { args: { flow: { ...base, step: { kind: 'source' },
  placeholder: ADD_PROJECT_TEXT.searchPlaceholder,
  sections: [{ key: 'sources', label: ADD_PROJECT_TEXT.sources, rows: sourceRows('', null) }],
} } }
export const Loading = { args: { flow: { ...base, sections: [], loading: true } } }
export const Searching = { args: { flow: { ...base, query: 'expo', sections: [{
  key: 'search', label: ADD_PROJECT_TEXT.githubSearching, icon: 'search', searching: true, rows: [],
}] } } }
export const SearchingWithMatches = { args: { flow: { ...base, query: 'expo', sections: [
  base.sections[0], ...Searching.args.flow.sections,
] } } }
export const NoMatches = { args: { flow: { ...base, query: 'missing', sections: [], emptyMessage: ADD_PROJECT_TEXT.githubNoRepos } } }
export const GitHubUnavailable = { args: { flow: { ...base, sections: [], emptyMessage: ADD_PROJECT_TEXT.githubNeedCli } } }
export const Failed = { args: { flow: { ...base, error: 'Permission denied' } } }
export const Cloning = { args: { flow: { ...base, step: {
  kind: 'destination', source: 'url', repoInput: 'https://example.invalid/repo.git',
  remoteUrl: 'https://example.invalid/repo.git', repoName: 'repo',
}, query: '~/Developer/', busy: true, clonePreview: {
  repoLabel: 'https://example.invalid/repo.git', remoteUrl: 'https://example.invalid/repo.git', path: '~/Developer/repo',
} } } }
export const Narrow = { render: (props: ComponentProps<typeof AddProjectScreen>) => <Preview {...props} width={320} /> }

function InteractivePage() {
  const flow = useAddProject({
    request: async (command) => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return previewAddProjectRequest(command)
    },
    onAdded: noop,
  })
  return <AddProjectScreen flow={{ ...flow, sections: flow.sections.map((section) => ({
    ...section, rows: section.rows.map((row) => row.avatarUrl ? { ...row, avatarUrl: unavailableAvatar } : row),
  })) }} />
}

export const InteractiveSearch = {
  render: () => <MobileThemeProvider><View style={{ width: 390, height: 600 }}><InteractivePage /></View></MobileThemeProvider>,
}
