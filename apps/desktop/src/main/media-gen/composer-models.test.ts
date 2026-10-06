import { expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ resolve: vi.fn(), models: vi.fn() }))
vi.mock('../providers/credential-store', () => ({ listCredentials: () => [{ id: 'key', name: 'My Provider' }, { id: 'deleted', name: 'Old Provider' }] }))
vi.mock('../providers/resolver', () => ({ resolveService: f.resolve, listServiceModels: f.models }))
import { mediaComposerModels } from './composer-models'

it('keeps image and video models separate and rejects credential fallback', () => {
  f.models.mockImplementation(consumer => [{ id: consumer === 'media:image' ? 'image' : 'video', name: 'Model' }])
  f.resolve.mockImplementation(consumer => ({ credentialId: 'key', apiKey: 'secret', models: [{ id: consumer === 'media:image' ? 'image' : 'video' }] }))
  expect(mediaComposerModels('image')).toEqual([{ providerId: 'key', providerLabel: 'My Provider', model: 'image', label: 'Model', default: true }])
  expect(mediaComposerModels('video').map(model => model.model)).toEqual(['video'])
})
it('describes the controls of the adapter serving each model', () => {
  f.models.mockImplementation(consumer => [{ id: consumer === 'media:image' ? 'gpt-image-1' : 'doubao-seedance-1-5-pro', name: 'Model' }])
  f.resolve.mockImplementation(consumer => ({ credentialId: 'key', apiKey: 'secret', platformId: 'openai',
    protocol: consumer === 'media:image' ? 'openai-images' : 'ark-video', models: [] }))
  expect(mediaComposerModels('image')[0]!.image).toEqual({ aspectRatios: [], sizes: ['1024x1024', '1536x1024', '1024x1536'] })
  expect(mediaComposerModels('video')[0]!.video).toMatchObject({ resolutions: ['854x480', '1280x720', '1920x1080'], generateAudio: true, watermark: true })
})
it('does not expose credentials without a usable key', () => {
  f.resolve.mockReturnValue({ credentialId: 'key', apiKey: '', models: [] })
  expect(mediaComposerModels('image')).toEqual([])
})
