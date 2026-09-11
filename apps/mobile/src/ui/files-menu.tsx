import { FolderPlus, Search, TextCursorInput, Upload } from 'lucide-react-native'
import { useMobileTheme } from '../theme/context'
import { MenuRow, MenuSeparator } from './anchored-menu'

export function FilesMenuBody(props: {
  kind: 'project' | 'computer'
  onSearch: () => void
  onUploadFile: () => void
  onNewFolder: () => void
}) {
  const { tokens } = useMobileTheme()
  const muted = tokens.colors.mutedForeground
  return (
    <>
      <MenuRow
        label={props.kind === 'computer' ? 'Go to folder' : 'Search files'}
        leading={props.kind === 'computer'
          ? <TextCursorInput size={18} color={muted} />
          : <Search size={18} color={muted} />}
        onPress={props.onSearch}
      />
      <MenuSeparator />
      <MenuRow
        label="Upload file"
        leading={<Upload size={18} color={muted} />}
        onPress={props.onUploadFile}
      />
      <MenuRow
        label="New folder"
        leading={<FolderPlus size={18} color={muted} />}
        onPress={props.onNewFolder}
      />
    </>
  )
}
