import { BackSide, BoxGeometry, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, PMREMGenerator, PointLight, Scene, type WebGLRenderer } from 'three'

/**
 * Neutral studio arrangement adapted from Google model-viewer's EnvironmentScene.
 * Copyright 2021 Google LLC; Apache-2.0. See model-environment.NOTICE.md.
 */
function createNeutralStudio(): { scene: Scene; dispose: () => void } {
  const scene = new Scene()
  scene.position.y = -3.5
  const geometry = new BoxGeometry()
  geometry.deleteAttribute('uv')
  const wallMaterial = new MeshStandardMaterial({ color: 0xffffff, side: BackSide })
  const blockerMaterial = new MeshStandardMaterial({ color: 0xffffff })
  const panelMaterials: MeshBasicMaterial[] = []

  const topLight = new PointLight(0xffffff, 400, 28, 2)
  topLight.position.set(0.5, 14, 0.5)
  scene.add(topLight)

  const room = new Mesh(geometry, wallMaterial)
  room.position.set(0, 13.2, 0)
  room.scale.set(31.5, 28.5, 31.5)
  scene.add(room)

  for (const [position, rotation, scale] of [
    [[-10.906, -1, 1.846], -0.195, [2.328, 7.905, 4.651]],
    [[-5.607, -0.754, -0.758], 0.994, [1.97, 1.534, 3.955]],
    [[6.167, -0.16, 7.803], 0.561, [3.927, 6.285, 3.687]],
    [[-2.017, 0.018, 6.124], 0.333, [2.002, 4.566, 2.064]],
    [[2.291, -0.756, -2.621], -0.286, [1.546, 1.552, 1.496]],
    [[-2.193, -0.369, -5.547], 0.516, [3.875, 3.487, 2.986]],
  ] as const) {
    const blocker = new Mesh(geometry, blockerMaterial)
    blocker.position.set(position[0], position[1], position[2])
    blocker.rotation.y = rotation
    blocker.scale.set(scale[0], scale[1], scale[2])
    scene.add(blocker)
  }

  for (const [intensity, position, scale] of [
    [80, [-14, 10, 8], [0.1, 2.5, 2.5]],
    [80, [-14, 14, -4], [0.1, 2.5, 2.5]],
    [23, [14, 12, 0], [0.1, 5, 5]],
    [80, [0, 9, 14], [5, 5, 0.1]], // broad front reflection for dark USDZ finishes
    [80, [7, 8, -14], [2.5, 2.5, 0.1]],
    [80, [-7, 16, -14], [2.5, 2.5, 0.1]],
  ] as const) {
    const material = new MeshBasicMaterial()
    material.color.setScalar(intensity)
    panelMaterials.push(material)
    const panel = new Mesh(geometry, material)
    panel.position.set(position[0], position[1], position[2])
    panel.scale.set(scale[0], scale[1], scale[2])
    scene.add(panel)
  }

  return {
    scene,
    dispose: () => {
      geometry.dispose()
      wallMaterial.dispose()
      blockerMaterial.dispose()
      for (const material of panelMaterials) material.dispose()
    },
  }
}

/** Gentle direct fill keeps non-PBR meshes legible without flattening metallic reflections. */
export function addModelFillLights(scene: Scene): void {
  scene.add(new HemisphereLight(0xffffff, 0xaaaaaa, 0.5))
  const light = new DirectionalLight(0xffffff, 0.7)
  light.position.set(2, 4, 5)
  scene.add(light)
}

/** PBR metals need reflected light; direct lamps alone leave USDZ finishes nearly black. */
export function lightModel(scene: Scene, renderer: WebGLRenderer): () => void {
  const studio = createNeutralStudio()
  const pmrem = new PMREMGenerator(renderer)
  const environment = (() => {
    try {
      return pmrem.fromScene(studio.scene)
    } finally {
      studio.dispose()
      pmrem.dispose()
    }
  })()
  scene.environment = environment.texture
  scene.environmentIntensity = 1.5
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1
  return () => {
    scene.environment = null
    environment.dispose()
  }
}
