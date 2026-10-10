import { describe, expect, it } from 'vitest'
import { TopicHub, deliveryPolicy, type DeliveryPolicy } from '@superone/runtime/stream'
import { topicKey } from '@superone/shared/environment/topics'
import { RendererInterest } from './renderer-interest'

function setup() {
  const hub = new TopicHub<string, DeliveryPolicy>()
  const connection = hub.open({ id: 'renderer', policy: deliveryPolicy('ipc', 'desktop'), sink: { deliver: () => {} } })
  return { connection, interest: new RendererInterest(connection, 'env-local'), keys: () => connection.topics().map(topicKey).sort() }
}

describe('RendererInterest', () => {
  it('always follows local sessions, terminals, drafts and environment notices', () => {
    const { keys } = setup()
    expect(keys()).toEqual(['drafts:env-local', 'environment:env-local', 'session:env-local:*', 'terminal:env-local:*', 'terminalList:env-local'])
  })

  it('follows the remote sessions windows show until the last view goes, per window', () => {
    const { interest, keys } = setup()
    const remote = { environmentId: 'node-b', sessionId: 'n1' }
    interest.setShown(1, remote, true)
    interest.setShown(2, remote, true)
    expect(keys()).toContain('session:node-b:n1')
    expect(keys()).toContain('environment:node-b')
    interest.setShown(1, remote, false)
    expect(keys()).toContain('session:node-b:n1')
    expect(interest.closeWindow(2)).toEqual([remote])
    expect(keys()).not.toContain('session:node-b:n1')
    expect(interest.shown()).toEqual([])
  })

  it('returns one entry per view a closed window still held', () => {
    const { interest } = setup()
    const local = { environmentId: 'env-local', sessionId: 's1' }
    interest.setShown(3, local, true)
    interest.setShown(3, local, true)
    expect(interest.closeWindow(3)).toEqual([local, local])
  })

  it('follows remote terminals while attached, with their machine\'s terminal list', () => {
    const { interest, keys } = setup()
    interest.attachTerminal({ environmentId: 'node-b', terminalId: 't1' }, true)
    expect(keys()).toEqual(expect.arrayContaining(['terminal:node-b:t1', 'terminalList:node-b']))
    interest.attachTerminal({ environmentId: 'node-b', terminalId: 't1' }, false)
    expect(keys()).not.toContain('terminal:node-b:t1')
    expect(keys()).not.toContain('terminalList:node-b')
  })
})
