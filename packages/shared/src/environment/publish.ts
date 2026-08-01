/**
 * Public npm identity for the open-source SuperOne node CLI.
 * Desktop remote install and user docs must use these names — not monorepo
 * workspace ids (`@superone/*`).
 *
 * See design §15.1–15.2.
 */

/** npm organization scope (public). */
export const PUBLIC_NPM_SCOPE = '@super-one'

/** Published headless node package. */
export const PUBLIC_CLI_PACKAGE = `${PUBLIC_NPM_SCOPE}/cli` as const

/** Global binary name after `npm i -g @super-one/cli`. */
export const PUBLIC_CLI_BIN = 'superone'

/** How Desktop gets `superone` onto a remote host over SSH. */
export type RemoteInstallSource = 'registry' | 'upload'

export const DEFAULT_REMOTE_INSTALL_SOURCE: RemoteInstallSource = 'registry'
