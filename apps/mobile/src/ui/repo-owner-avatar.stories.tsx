import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { RepoOwnerAvatar } from './repo-owner-avatar'

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const BROKEN = 'data:image/png;base64,invalid'

function Preview(props: { owner: string; uri: string; status?: 'loading' | 'ready' | 'failed' }) {
  return <MobileThemeProvider><View style={{ padding: 24 }}><RepoOwnerAvatar {...props} /></View></MobileThemeProvider>
}

export default {
  title: 'Mobile/RepoOwnerAvatar', component: RepoOwnerAvatar, render: Preview,
  args: { owner: 'expo', uri: PIXEL, status: 'loading' },
}

export const Loading = {}
export const Failed = { args: { uri: BROKEN, status: 'failed' } }
export const Organization = { args: { owner: 'engineering-platform', uri: BROKEN, status: 'failed' } }
export const Loaded = { args: { uri: PIXEL, status: 'ready' } }
