import { MobileThemeProvider } from '../theme/context'
import { SessionTitleGallery } from '../preview/SessionTitleGallery'

export default {
  title: 'Mobile/SessionTitles',
  component: SessionTitleGallery,
  render: () => <MobileThemeProvider><SessionTitleGallery /></MobileThemeProvider>,
}
export const RenameAndRunStates = { name: 'Shared desktop CSS · native handoff, short and long titles' }
