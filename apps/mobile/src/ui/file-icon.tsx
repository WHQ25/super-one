import { memo } from 'react'
import { SvgXml } from 'react-native-svg'
import { useMobileTheme } from '../theme/context'
import { fileIconSvg } from './file-icon-data'

/** Same Symbols artwork and filename rules as the desktop FileIcon. */
export const FileTypeIcon = memo(function FileTypeIcon({ name, directory = false, size = 20 }: {
  name: string
  directory?: boolean
  size?: number
}) {
  const { tokens } = useMobileTheme()
  return <SvgXml xml={fileIconSvg(name, directory)} width={size} height={size}
    color={tokens.colors.foreground} accessible={false} />
})
