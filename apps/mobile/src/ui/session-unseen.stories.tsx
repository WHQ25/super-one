import { MobileThemeProvider } from '../theme/context'
import { SessionUnseenGallery } from '../preview/SessionUnseenGallery'

export default { title: 'Mobile/SessionUnseen', component: SessionUnseenGallery,
  render: () => <MobileThemeProvider><SessionUnseenGallery /></MobileThemeProvider> }
export const BackgroundCompletionAndRead = {}
