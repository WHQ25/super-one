import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { getIconForFile, getIconForFolder } from '@react-symbols/icons/utils'
import data from './file-icons.generated.json'
import { fileIconSvg } from './file-icon-data'
import { MODEL_MIME } from '@superone/shared/file-preview'
import { modelFileIconSvg } from '@superone/shared/model-file-icon'
import { officeFileIconSvg } from '@superone/shared/office-file-icon'

describe('native Symbols parity with the installed desktop source', () => {
  it('uses a model icon for every supported 3D extension', () => {
    for (const extension of Object.keys(MODEL_MIME)) {
      expect(fileIconSvg(`/models/phone${extension}`), extension).toBe(modelFileIconSvg(extension))
    }
    expect(fileIconSvg('scene.GLB')).toBe(fileIconSvg('scene.gltf'))
    expect(fileIconSvg('rig.fbx')).not.toBe(fileIconSvg('scene.glb'))
    expect(fileIconSvg('phone.usdz')).not.toBe(fileIconSvg('rig.fbx'))
    expect(modelFileIconSvg('phone.pdf')).toBeUndefined()
  })

  it('uses a distinct Office icon for the Word, Excel and PowerPoint names', () => {
    for (const extension of ['.doc', '.docx']) {
      expect(fileIconSvg(`notes${extension}`), extension).toBe(officeFileIconSvg(extension))
    }
    for (const extension of ['.xls', '.xlsx', '.xlsm']) {
      expect(fileIconSvg(`model${extension}`), extension).toBe(officeFileIconSvg(extension))
    }
    for (const extension of ['.ppt', '.pptx']) {
      expect(fileIconSvg(`deck${extension}`), extension).toBe(officeFileIconSvg(extension))
    }
    expect(fileIconSvg('Report.DOCX')).toBe(fileIconSvg('notes.docx'))
    expect(fileIconSvg('notes.docx')).not.toBe(fileIconSvg('model.xlsx'))
    expect(fileIconSvg('model.xlsx')).not.toBe(fileIconSvg('deck.pptx'))
    expect(fileIconSvg('notes.docx')).not.toBe(fileIconSvg('unknown.zzzz'))
    expect(officeFileIconSvg('notes.pdf')).toBeUndefined()
  })
  it('matches filenames, compound suffixes and case handling', () => {
    const names = new Set([
      ...Object.keys(data.files),
      ...Object.keys(data.extensions).map((extension) => `example.${extension}`),
      'Dockerfile', 'README.md', 'Component.test.tsx', 'types.d.ts', 'archive.tar.gz',
      'PACKAGE.JSON', '.env.local', 'unknown.zzzz', 'LICENSE', '',
    ])
    // Symbols draws xls/xlsx/xlsm with the generic table icon. Those names use the Excel mark.
    const officeMarks = new Set(['example.xls', 'example.xlsx', 'example.xlsm'])
    for (const name of names) {
      if (officeMarks.has(name)) continue
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
