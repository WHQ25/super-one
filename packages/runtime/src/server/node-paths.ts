import { join } from 'node:path'

/** On-disk layout used by node identity (environment id, instance key, binding). */
export function nodeIdentityPaths(nodeHome: string) {
  return {
    nodeHome,
    environmentId: join(nodeHome, 'environment-id'),
    secretsDir: join(nodeHome, 'secrets'),
    instanceKey: join(nodeHome, 'secrets', 'instance.key'),
    logsDir: join(nodeHome, 'logs'),
  }
}
