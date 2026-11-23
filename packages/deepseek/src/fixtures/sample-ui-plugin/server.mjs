export const name = '@acme/dsh-sample-ui'
export const inject = ['pluginRpc']

export function apply(ctx) {
  ctx.pluginRpc.handle('inspectTool', async (payload) => {
    const label = typeof payload?.toolName === 'string' ? payload.toolName : 'unknown'
    return {
      inspectedBy: '@acme/dsh-sample-ui',
      toolName: label,
      ok: true,
    }
  })
  ctx.pluginRpc.emit('sample:ready', { version: '1.0.0' })
}
