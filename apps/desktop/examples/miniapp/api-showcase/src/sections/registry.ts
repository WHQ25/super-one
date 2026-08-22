import type { SectionDef } from '../components/Section'
import { themeSection } from './theme'
import { localeSection } from './locale'
import { agentSection } from './agent'
import { systemSection } from './system'
import { uiSection } from './ui'
import { mediaSection } from './media'
import { toolsSection } from './tools'

export const SECTIONS: SectionDef[] = [
  themeSection,
  localeSection,
  agentSection,
  systemSection,
  uiSection,
  mediaSection,
  toolsSection,
]
