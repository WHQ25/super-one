/**
 * Minimal `electron` stand-in for scripts that run outside the app.
 *
 * `database-migrations.ts` reaches `electron` through `crypto/secret-store`
 * (safeStorage). ELECTRON_RUN_AS_NODE does *not* provide that module, so the
 * migration smoke test runs on plain Node with this stub swapped in by
 * `register-electron-stub.mjs`.
 */

export const safeStorage = {
  // Matches the production fallback for machines without OS encryption: values
  // stay plaintext, so a migration that re-encrypts secrets is still exercised
  // end to end without touching the real keychain.
  isEncryptionAvailable: () => false,
  encryptString: (value) => Buffer.from(value),
  decryptString: (buffer) => buffer.toString(),
}

export const app = {
  getPath: () => process.cwd(),
  getVersion: () => 'migration-smoke-test',
  isReady: () => true,
  quit: () => {},
}

export const dialog = {
  showErrorBox: (title, content) => console.error(`[electron-stub] ${title}: ${content}`),
  showMessageBoxSync: () => 1,
}

export default { safeStorage, app, dialog }
