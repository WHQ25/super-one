/** Fake node and phone domains supply their own catalog, not the desktop DB. */
export function fixtureSessionProviderRepository() {
  return { getSessionProvider: () => null }
}
