import { createLucideIcon } from 'lucide-react-native'
import { GITHUB_ICON_NODE } from '@superone/shared/github-icon-node'

/** lucide 1.0 dropped `Github`; see `GITHUB_ICON_NODE` for why the glyph is carried locally. */
export const GithubIcon = createLucideIcon('github', GITHUB_ICON_NODE)
