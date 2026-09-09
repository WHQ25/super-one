import { MobileThemeProvider } from '../theme/context'
import { SessionAttentionGallery } from '../preview/SessionAttentionGallery'

export default { title: 'Mobile/SessionAttention', component: SessionAttentionGallery,
  render: () => <MobileThemeProvider><SessionAttentionGallery /></MobileThemeProvider> }
export const PendingAndResolved = {}
