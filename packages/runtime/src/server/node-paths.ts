import { join } from 'node:path'

/** On-disk layout used by node identity (environment id, instance key, binding). */
export function nodeIdentityPaths(nodeHome: string) {
  return {
    nodeHome,
    environmentId: join(nodeHome, 'environment-id'),
    secretsDir: join(nodeHome, 'secrets'),
    instanceKey: join(nodeHome, 'secrets', 'instance.key'),
    /** Root of per-pairing secrets for the encrypted node channel. */
    channelRoot: join(nodeHome, 'secrets', 'channel-root.key'),
    logsDir: join(nodeHome, 'logs'),
  }
}
