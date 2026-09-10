import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { RepoOwnerAvatar } from './repo-owner-avatar'

function Preview(props: { owner: string; uri: string }) {
  return <MobileThemeProvider><View style={{ padding: 24 }}><RepoOwnerAvatar {...props} /></View></MobileThemeProvider>
}

export default {
  title: 'Mobile/RepoOwnerAvatar', component: RepoOwnerAvatar, render: Preview,
  args: { owner: 'expo', uri: 'data:image/png;base64,invalid' },
}

export const LoadingOrFailed = {}
export const Organization = { args: { owner: 'engineering-platform' } }
// An inline image keeps the loaded state reproducible offline.
export const Loaded = { args: { uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' } }
