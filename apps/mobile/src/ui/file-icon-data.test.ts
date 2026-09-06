import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { getIconForFile, getIconForFolder } from '@react-symbols/icons/utils'
import data from './file-icons.generated.json'
import { fileIconSvg } from './file-icon-data'

describe('native Symbols parity with the installed desktop source', () => {
  it('matches filenames, compound suffixes and case handling', () => {
    const names = new Set([
      ...Object.keys(data.files),
      ...Object.keys(data.extensions).map((extension) => `example.${extension}`),
      'Dockerfile', 'README.md', 'Component.test.tsx', 'types.d.ts', 'archive.tar.gz',
      'PACKAGE.JSON', '.env.local', 'unknown.zzzz', 'LICENSE', '',
    ])
    for (const name of names) {
      expect(fileIconSvg(name), name).toBe(renderToStaticMarkup(getIconForFile({ fileName: name, autoAssign: true })))
    }
  })

  it('matches named and unknown folders without changing desktop casing', () => {
    for (const name of [...Object.keys(data.folders), 'unknown-folder', 'SRC', '']) {
      expect(fileIconSvg(name, true), name).toBe(renderToStaticMarkup(getIconForFolder({ folderName: name })))
    }
  })

  it('resolves remote paths and treats prototype names as unknown files', () => {
    expect(fileIconSvg('/project/src/index.ts')).toBe(fileIconSvg('index.ts'))
    expect(fileIconSvg('C:\\project\\package.json')).toBe(fileIconSvg('package.json'))
    expect(fileIconSvg('/project/src/', true)).toBe(fileIconSvg('src', true))
    expect(fileIconSvg('constructor')).toBe(fileIconSvg('unknown.zzzz'))
    expect(fileIconSvg('__proto__', true)).toBe(fileIconSvg('unknown-folder', true))
  })
})
