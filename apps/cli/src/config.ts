import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default node home: ~/.superone/node */
export const DEFAULT_NODE_HOME = join(homedir(), '.superone', 'node')

/** Default loopback bind for SSH-forward deployments. */
export const DEFAULT_BIND_HOST = '127.0.0.1'
export const DEFAULT_BIND_PORT = 7788

export interface NodeRuntimeConfig {
  nodeHome: string
  bindHost: string
  bindPort: number
  label?: string
}

export function resolveNodeHome(override?: string): string {
  return override || process.env.SUPERONE_NODE_HOME || DEFAULT_NODE_HOME
}

export function resolveRuntimeConfig(partial: Partial<NodeRuntimeConfig> = {}): NodeRuntimeConfig {
  return {
    nodeHome: resolveNodeHome(partial.nodeHome),
    bindHost: partial.bindHost || process.env.SUPERONE_NODE_HOST || DEFAULT_BIND_HOST,
    bindPort: partial.bindPort ?? Number(process.env.SUPERONE_NODE_PORT || DEFAULT_BIND_PORT),
    label: partial.label,
  }
}

export function nodePaths(nodeHome: string) {
  return {
    nodeHome,
    environmentId: join(nodeHome, 'environment-id'),
    stateDb: join(nodeHome, 'state.sqlite'),
    configJson: join(nodeHome, 'config.json'),
    secretsDir: join(nodeHome, 'secrets'),
    instanceKey: join(nodeHome, 'secrets', 'instance.key'),
    /** AES key for provider API secrets at rest (not the ed25519 instance key). */
    providerSecretsKey: join(nodeHome, 'secrets', 'provider-secrets.key'),
    logsDir: join(nodeHome, 'logs'),
    runtimeJson: join(nodeHome, 'runtime.json'),
  }
}
