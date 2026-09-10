/** Optional metadata must never keep the session restore/send lock occupied. */
export function refreshSessionCatalog<T>(
  load: () => Promise<T>,
  isCurrent: () => boolean,
  apply: (catalog: T) => void,
  onError: (error: unknown) => void,
): void {
  void Promise.resolve().then(load).then((catalog) => {
    if (isCurrent()) apply(catalog)
  }).catch((error: unknown) => {
    if (isCurrent()) onError(error)
  })
}
