import { join } from 'node:path'

export interface UserDataPathOptions {
  /** OS application-data root (`app.getPath('appData')`). */
  appData: string
  /**
   * Variant-scoped directory name (`variant().dataDirName`).
   *
   * This is the whole of SuperOne's data isolation between the side-by-side
   * stable and alpha apps, and it has to be passed explicitly: Electron
   * computes `userData` from package.json during init, before main runs, so
   * `app.setName()` does NOT move it. The caller must `app.setPath` this.
   */
  dataDirName: string
  /**
   * Optional extra isolation within one variant (`SUPERONE_INSTANCE`).
   * Used by the e2e harness so a test run cannot touch a real profile.
   */
  instance?: string | null
}

export function packagedUserDataPath(options: UserDataPathOptions): string {
  const base = join(options.appData, options.dataDirName)
  const instance = options.instance?.trim()
  return instance ? join(base, `instance-${instance}`) : base
}
