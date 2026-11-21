import { describe, it, expect } from 'vitest'
import { createLspFrameParser, encodeLspFrame } from './lsp-manager'
import { parseMasonPurl } from './lsp-registry'

describe('LSP stdio framing', () => {
  it('encodes and parses chunked UTF-8 LSP JSON-RPC frames', () => {
    const received: string[] = []
    const parse = createLspFrameParser((msg) => received.push(msg))

    const msg1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { text: '你好世界' } })
    const msg2 = JSON.stringify({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'ok' } })
    const combined = Buffer.from(encodeLspFrame(msg1) + encodeLspFrame(msg2), 'utf8')

    parse(combined.slice(0, 12))
    parse(combined.slice(12, 45))
    parse(combined.slice(45))

    expect(received).toEqual([msg1, msg2])
  })
})

describe('parseMasonPurl', () => {
  it('parses npm, pypi, golang, cargo, and github PURLs', () => {
    expect(parseMasonPurl('pkg:npm/%40svelte%2Flanguage-server@0.16.0')).toMatchObject({
      purlType: 'npm',
      packageName: '@svelte/language-server',
      installable: true,
    })
    expect(parseMasonPurl('pkg:pypi/python-lsp-server@1.10.0')).toMatchObject({
      purlType: 'pypi',
      packageName: 'python-lsp-server',
      installable: true,
    })
    expect(parseMasonPurl('pkg:golang/golang.org/x/tools/gopls@v0.15.3')).toMatchObject({
      purlType: 'golang',
      packageName: 'golang.org/x/tools/gopls',
      installable: true,
    })
    expect(parseMasonPurl('pkg:cargo/taplo-cli@0.9.0')).toMatchObject({
      purlType: 'cargo',
      packageName: 'taplo-cli',
      installable: true,
    })
    expect(parseMasonPurl('pkg:github/LuaLS/lua-language-server@3.7.4')).toMatchObject({
      purlType: 'github',
      packageName: 'LuaLS/lua-language-server',
      installable: false,
    })
  })
})
