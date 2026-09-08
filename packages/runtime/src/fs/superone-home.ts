import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export type SuperoneVariant = 'stable' | 'alpha' | 'dev'
export const SUPERONE_DIRNAME = '.superone'

/** Relative to a user's home; also safe to use with a remote POSIX home. */
export function superoneHomeSegments(variant: SuperoneVariant): string[] {
  return variant === 'stable' ? [SUPERONE_DIRNAME] : [SUPERONE_DIRNAME, variant]
}

export function resolveSuperoneHome(options: {
  userHome?: string
  variant?: SuperoneVariant
  ignoreEnv?: boolean
} = {}): string {
  const override = options.ignoreEnv ? undefined : process.env.SUPERONE_HOME?.trim()
  if (override) {
    if (!isAbsolute(override)) throw new Error('SUPERONE_HOME must be an absolute path.')
    return override
  }
  const variant = options.variant ?? process.env.SUPERONE_VARIANT ?? 'stable'
  if (variant !== 'stable' && variant !== 'alpha' && variant !== 'dev') throw new Error(`Invalid SuperOne variant: ${variant}`)
  return join(options.userHome ?? homedir(), ...superoneHomeSegments(variant))
}

/** Project storage never uses the personal SUPERONE_HOME override. */
export function resolveProjectSuperoneHome(projectRoot: string, variant?: SuperoneVariant): string {
  return resolveSuperoneHome({ userHome: projectRoot, variant, ignoreEnv: true })
}
