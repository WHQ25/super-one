import { describe, expect, it } from 'vitest'
import { platform } from 'node:os'
import { collectMachineInfo, parseLspci, parseMacDisplays, parseOsRelease, type RunCommand } from './machine-info'

describe('machine info parsers', () => {
  it('reads GPU models from system_profiler JSON', () => {
    const json = JSON.stringify({ SPDisplaysDataType: [{ sppci_model: 'Apple M3 Max', sppci_cores: '40' }, { _name: 'no model' }] })
    expect(parseMacDisplays(json)).toEqual(['Apple M3 Max'])
    expect(parseMacDisplays('not json')).toEqual([])
  })

  it('reads display controllers from lspci', () => {
    const output = [
      '00:02.0 VGA compatible controller: Intel Corporation UHD Graphics 630 (rev 02)',
      '00:1f.3 Audio device: Intel Corporation Cannon Lake PCH cAVS (rev 10)',
      '01:00.0 3D controller: NVIDIA Corporation GA102 [GeForce RTX 3090] (rev a1)',
    ].join('\n')
    expect(parseLspci(output)).toEqual(['Intel Corporation UHD Graphics 630', 'NVIDIA Corporation GA102 [GeForce RTX 3090]'])
  })

  it('reads PRETTY_NAME from os-release', () => {
    expect(parseOsRelease('NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n')).toBe('Ubuntu 24.04.1 LTS')
    expect(parseOsRelease('NAME=Alpine')).toBeUndefined()
  })
})

describe('collectMachineInfo', () => {
  it('omits facts whose probes fail instead of inventing them', async () => {
    const failing: RunCommand = async () => null
    const info = await collectMachineInfo(failing)
    expect(info.cpuCores).toBeGreaterThan(0)
    expect(info.memoryBytes).toBeGreaterThan(0)
    expect(info).not.toHaveProperty('gpus')
    expect(info.os.length).toBeGreaterThan(0)
  })

  it.runIf(platform() === 'darwin')('names macOS from sw_vers and GPUs from system_profiler', async () => {
    const run: RunCommand = async (file) => {
      if (file === 'sw_vers') return '26.0\n'
      if (file === 'system_profiler') return JSON.stringify({ SPDisplaysDataType: [{ sppci_model: 'Apple M3 Max' }] })
      return null
    }
    const info = await collectMachineInfo(run)
    expect(info.os).toBe('macOS 26.0')
    expect(info.gpus).toEqual(['Apple M3 Max'])
  })
})
