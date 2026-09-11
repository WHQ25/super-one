import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { FilesMenuBody } from './files-menu'

function Frame({ kind }: { kind: 'project' | 'computer' }) {
  return (
    <MobileThemeProvider>
      <View style={{ width: 280, padding: 8, backgroundColor: '#1c1c1e', borderRadius: 12 }}>
        <FilesMenuBody kind={kind} onSearch={() => {}} onUploadFile={() => {}} onNewFolder={() => {}} />
      </View>
    </MobileThemeProvider>
  )
}

export default {
  title: 'Mobile/FilesMenu',
  component: FilesMenuBody,
}

export const Project = {
  name: 'Project · search, upload, new folder',
  render: () => <Frame kind="project" />,
}

export const Computer = {
  name: 'Computer · go to folder, upload, new folder',
  render: () => <Frame kind="computer" />,
}
