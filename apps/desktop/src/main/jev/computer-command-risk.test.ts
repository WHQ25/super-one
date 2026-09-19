import { describe, expect, it } from 'vitest'
import { ComputerUseService } from '../computer-use/computer-use-service'
import { FakePlatformBackend } from '../computer-use/platform/fake-backend'
import { classify } from './action-space'
import { computerPage } from './computer-page'

describe('desktop menu command risk', () => {
  it('guards lifecycle commands and requires allow for non-navigation commands', async () => {
    const labels = ['Quit Editor', 'Restart…', 'Shut Down…', 'Log Out User…', 'Empty Trash', 'Force Quit', 'Show Fonts', 'Show Sidebar']
    const backend = new FakePlatformBackend([{ app: 'Editor', bundleId: 'com.test.editor', pid: 7,
      menuBar: { role: 'menuBar', children: labels.map((name) => ({ role: 'menuItem', name })) },
      windows: [{ title: 'Document', tree: { role: 'window', children: [{ role: 'menuItem', name: 'Open popup choice' }] } }],
    }])
    const service = new ComputerUseService({ adapter: backend, bypassPolicy: true })
    service.policy.grantSession({ app: 'Editor', bundleId: 'com.test.editor', tier: 'full' })
    const page = computerPage(await service.observe(undefined, 'semantic'), service)
    const element = (label: string) => page.elements.find((node) => node.label === label)!
    for (const label of labels.slice(0, 6)) {
      expect(classify(element(label), new Set(), [])).toMatchObject({ risk: 'guarded', highRisk: true })
    }
    expect(element('Show Fonts').role).toBe('button')
    expect(classify(element('Show Fonts'), new Set(), []).risk).toBe('guarded')
    expect(classify(element('Show Fonts'), new Set(), ['Show Fonts']).risk).toBe('safe')
    expect(classify(element('Show Sidebar'), new Set(), []).risk).toBe('safe')
    expect(element('Open popup choice').role).toBe('menuitem')
    expect(classify(element('Open popup choice'), new Set(), []).risk).toBe('safe')
  })
})
