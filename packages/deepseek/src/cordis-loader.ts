/**
 * The loader-entry seam, typed against the real `Loader` service.
 *
 * Two registrars drive live loader rows — third-party MCP servers
 * (`mcp-servers.ts`) and installed dsh plugins (`plugin-host/mount.ts`) — and
 * both used to carry their own identical hand-written copy of this shape. A
 * duplicated structural type is the failure mode this module exists to remove:
 * TypeScript then validates our calls against our own declaration, so an
 * upstream signature change stays green and breaks at runtime instead.
 *
 * Everything here is DERIVED from `Loader`, so a changed upstream signature is
 * a compile error at the derivation rather than a silent divergence.
 */

import type { EntryOptions, Loader } from '@deepseek-ai/cordis-plugin-loader'

/**
 * The loader methods these registrars call.
 *
 * `update` / `remove` / `await` are taken straight off `Loader`. `create` is the
 * one deliberate widening: upstream types its options as
 * `Omit<EntryOptions, 'id'>`, but `EntryTree.ensureId()` reads `options.id` and
 * only mints a random one when it is absent — so the runtime honours a caller
 * supplied id even though the published type refuses it. Both registrars depend
 * on that, because a stable id is what makes a loader tree dump readable and
 * what lets a reconcile pass address the row it created. The widening is
 * derived from `Loader['create']` rather than restated, so a change to the rest
 * of that signature still breaks here.
 */
export type LoaderEntries = Pick<Loader, 'update' | 'remove' | 'await'> & {
  create(
    options: Parameters<Loader['create']>[0] & Pick<EntryOptions, 'id'>,
  ): Promise<string>
}
