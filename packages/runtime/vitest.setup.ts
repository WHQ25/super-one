// A SuperOne-launched shell exports SUPERONE_HOME / SUPERONE_VARIANT, and the
// home-path resolvers honour them ahead of a test's explicit userHome. Strip
// them so path assertions match CI (same as apps/desktop/vitest.setup.ts).
delete process.env.SUPERONE_HOME
delete process.env.SUPERONE_VARIANT
