# Vendored dsh agent presets

Copies of the four preset declarations `@deepseek-ai/dsh` ships in
`packages/bundle/web-app/presets/`, pinned to the same `0.2.2-rc.1` line as the
rest of the family. Each file is a Cordis patch list whose one `insert` row
declares a preset through `@deepseek-ai/dsh-agent-preset`; `packages/deepseek`
applies the patches with `cordis-plugin-include`'s own patch semantics and
mounts the resulting rows next to `dsh-agent-preset-registry`.

They are verbatim **except for the host-owned tools**, marked with a
`SuperOne deviations` banner at the top of each affected file (`standard`,
`ptc`, `cordis`): the `tool-plugin-manager`, `tool-plugin-market` and
`tool-schedule` rows are dropped. SuperOne owns plugin installation and
scheduling; it does not mount the dsh profile, plugin-market or scheduling
services those rows require.

The PTC preset now selects `dsh-tool-executor-ptc` in its standing scope;
the host mounts the default native executor. Minimal includes the image
reader and compaction alongside its persistent shell. Delegation uses
upstream's immediate child-id return and the current model-selection settings.

They are vendored rather than read out of `node_modules` for two reasons. The
`@deepseek-ai/dsh-web-app` bundle that carries them pulls the whole
`dsh-client-ui-*` browser surface SuperOne replaces. And a preset **is** a
composition — its rows run with shell-level trust and its YAML may carry `!!js`
expressions — so the exact text that composes an agent belongs somewhere a
reviewer reads, not somewhere a transitive install decides.

Re-copy all four files whenever the pinned dsh version moves:

    cp <deepseek-harness>/packages/bundle/web-app/presets/{standard,minimal,ptc,cordis}.patch.yml \
       apps/desktop/resources/agent-presets/

then re-apply the deviation banner and remove the host-owned tool rows —
`packages/deepseek/src/bundled-plugins.test.ts` fails loudly if it is forgotten. Every
package a row names must also be pinned in both `packages/deepseek/package.json`
and `apps/desktop/package.json`; `bundled-plugins.test.ts` checks that.

Shipped to the packaged app through `extraResources` in `electron-builder.yml`.
There is no writable user root any more: upstream retired preset directories in
favour of declaration rows, so the roster is exactly these four files.
