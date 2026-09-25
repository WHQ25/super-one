import { NeutralToneMapping, PMREMGenerator, type Scene, type WebGLRenderer } from 'three'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import studioUrl from '../../assets/lighting/studio_lighting_objectmode_v002.exr?url'

/** Match the image-based lighting Apple provides for Quick Look object mode. */
export async function lightAppleUsdModel(scene: Scene, renderer: WebGLRenderer): Promise<() => void> {
  const studio = await new EXRLoader().loadAsync(studioUrl)
  const pmrem = new PMREMGenerator(renderer)
  const environment = (() => {
    try {
      return pmrem.fromEquirectangular(studio)
    } finally {
      studio.dispose()
      pmrem.dispose()
    }
  })()
  scene.environment = environment.texture
  scene.environmentIntensity = 1
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1
  return () => {
    scene.environment = null
    environment.dispose()
  }
}
