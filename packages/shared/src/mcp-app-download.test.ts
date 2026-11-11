import { describe, expect, it } from 'vitest'
import { isBlockedMcpAppDownloadItem, isBlockedMcpAppDownloadName, isMcpAppHttpDownload, mcpAppDownloadName } from './mcp-app-download'

describe('mcpAppDownloadName', () => {
  it('uses the file name of the URI, or a link name that is itself a file name', () => {
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///hex%20bolt.stl', text: '' } })).toBe('hex bolt.stl')
    expect(mcpAppDownloadName({ type: 'resource_link', uri: 'https://api.example.com/reports/q4.pdf?sig=1', name: 'Q4 Report' })).toBe('q4.pdf')
    expect(mcpAppDownloadName({ type: 'resource_link', uri: 'https://example.com/r/1', name: 'summary.csv' })).toBe('summary.csv')
    expect(mcpAppDownloadName({ type: 'resource_link', uri: 'cad://export/parts.csv', name: 'Parts' })).toBe('parts.csv')
  })

  it('never yields a path, a hidden file or an empty name', () => {
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///..%2F..%2Fetc%2Fpasswd', text: '' } })).toBe('_.._etc_passwd')
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///.bashrc', text: '' } })).toBe('bashrc')
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///', text: '' } })).toBe('download')
  })
})

describe('isMcpAppHttpDownload', () => {
  it('lets a device fetch only http(s) links without credentials', () => {
    expect(isMcpAppHttpDownload('https://example.com/a.pdf')).toBe(true)
    expect(isMcpAppHttpDownload('http://example.com/a.pdf')).toBe(true)
    expect(isMcpAppHttpDownload('https://user:pw@example.com/a.pdf')).toBe(false)
    expect(isMcpAppHttpDownload('cad://export/a.csv')).toBe(false)
    expect(isMcpAppHttpDownload('not a url')).toBe(false)
  })
})

describe('isBlockedMcpAppDownloadName', () => {
  it('blocks executable, installer, script-host and disguise names while allowing data and source files', () => {
    for (const blocked of ['payload.exe', 'PAYLOAD.EXE', 'installer.dmg', 'bundle.appimage', 'launcher.desktop', 'shortcut.lnk', 'page.hta', 'script.js', 'trick.exe.', 'trick.cmd . ', 'report.pdf:evil.exe', 'C:\\Users\\me\\Downloads\\setup.msi', '/tmp/pack.msix']) {
      expect(isBlockedMcpAppDownloadName(blocked), blocked).toBe(true)
    }
    for (const allowed of ['report.pdf', 'part.stl', 'script.py', 'deploy.sh', 'C:\\Users\\me\\Downloads\\report.pdf', '/Users/me/Downloads/archive.zip']) {
      expect(isBlockedMcpAppDownloadName(allowed), allowed).toBe(false)
    }
    expect(isBlockedMcpAppDownloadItem({ type: 'resource_link', uri: 'https://example.com/dropper.exe', name: 'Safe Name' })).toBe(true)
    expect(isBlockedMcpAppDownloadItem({ type: 'resource_link', uri: 'https://example.com/download/1', name: 'script.py' })).toBe(false)
  })
})
