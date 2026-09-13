# Codex ChatGPT accounts

SuperOne can register several ChatGPT logins on each host and bind a concrete
account to a new Codex conversation. The first authenticated account becomes the
default. Changing the default affects subsequent conversations. Existing API
provider bindings keep their existing precedence and legacy conversations retain
their original authentication resolution.

## Architecture

- `packages/codex/src/account-store.ts` owns node-local account metadata. Managed
  accounts use separate directories under `codex-accounts/<uuid>` in the SuperOne
  data directory. The existing CLI login is represented by the stable `cli` ID.
- `packages/codex/src/account-manager.ts` manages login, cancellation, account
  status, default selection and targeted logout for both desktop and CLI hosts.
  Codex itself stores and refreshes OAuth credentials; public APIs expose metadata.
- Sessions persist `codex-account:<id>` in the existing `apiProviderId` field.
  Provider resolvers recognize this namespace before applying API-key defaults.
- Each managed account receives its own `CODEX_HOME`, file credential store and
  SQLite directory. Common configuration and installed resources are inherited;
  credentials, databases and transcripts are not copied from the CLI profile.
- Session connections and metadata caches distinguish accounts. Reauthentication
  invalidates the selected account's connections; remote runners also track a
  persisted credential generation when deciding whether to reuse a process.
- Forks and side chats carry the source account. A conversation with history
  cannot switch to another account. Logout retains local history and prevents
  subsequent requests from silently falling back to another account.
- Browser sign-ins are serialized because OAuth uses a fixed callback port.
  Chat sessions remain concurrent. Remote nodes use device-code login.

## UI

Settings exposes account status, Add Account, Sign In, Sign Out and Set as Default.
The Codex model/provider selector lists account emails and plans. The desktop and
remote node use separate registries. English and Chinese strings are included.
Storybook `Settings/Codex Accounts` covers loading, empty, unavailable/error,
signed-out, pending browser/device-code login, default changes and narrow layouts.

## Validation

Targeted tests cover persistence, default changes, account environment isolation,
login/logout lifecycle, identity mismatch rejection, metadata connection reuse,
legacy conversation restoration, account-switch rejection and remote turn binding.
Desktop main/renderer, CLI, Codex core and runtime type checks were run.

A smoke check launched two instances of the pinned native Codex app-server with
empty test profiles concurrently. `account/read` returned signed out for both;
`config/read` confirmed independent SQLite homes, `file` credential stores and the
OpenAI provider. No real user login was read or changed by that smoke check.

Real authenticated acceptance remains to be performed: add two ChatGPT accounts,
start a separate conversation with each concurrently, change the default, restart
the app, then verify that each original conversation still uses its own account.
Also verify logout/relogin while preserving the other account's active conversation.
