/** The projected result of a dedicated row. Archive rows fetch their list on expand. */
export function isRemoteToolHeader(result: string | null | undefined): boolean {
  return result?.startsWith('{"remoteRows":') === true
}
