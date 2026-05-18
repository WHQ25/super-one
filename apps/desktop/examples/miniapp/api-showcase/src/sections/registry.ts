import type { SectionDef } from '../components/Section'
import { fsSection } from './fs'
import { gitSection } from './git'
import { dbSection } from './db'
import { themeSection } from './theme'
import { localeSection } from './locale'
import { agentSection } from './agent'
import { systemSection } from './system'
import { uiSection } from './ui'
import { mediaSection } from './media'
import { workerSection } from './worker'
import { toolsSection } from './tools'

export const SECTIONS: SectionDef[] = [
  fsSection,
  gitSection,
  dbSection,
  themeSection,
  localeSection,
  agentSection,
  systemSection,
  uiSection,
  mediaSection,
  workerSection,
  toolsSection,
]
