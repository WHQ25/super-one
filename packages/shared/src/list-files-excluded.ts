/**
 * Directories never worth listing in a file picker or an `@` mention browse.
 *
 * This is a **fixed set, not gitignore**. The desktop's directory listing has
 * always worked this way, and the mention browse on both surfaces mirrors it so
 * the same `@src/` shows the same entries. Anything that wants project-specific
 * ignores has to ask the host to apply them; a client cannot read `.gitignore`.
 *
 * Lives here rather than in `@superone/runtime` because Metro cannot import
 * that package — it is Node-only — and the mobile composer needs the same list
 * to filter a host response that predates the option.
 */
export const LIST_FILES_EXCLUDED: ReadonlySet<string> = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.venv',
  '.gradle',
  '.cargo',
  '.tox',
  '.mypy_cache',
  'node_modules',
  'dist',
  'build',
  '__pycache__',
])
