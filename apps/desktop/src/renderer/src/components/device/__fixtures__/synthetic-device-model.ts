import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

/**
 * Stand-ins for Apple's AR scenes, which cannot be committed: prims under random
 * names, a black glass lit by an emissive wallpaper, and the arrangements the real
 * scenes use — two sizes side by side, one of them turned to show its back, and a
 * tablet leaning on its keyboard.
 */

function phone(width: number, height: number): Group {
  const device = new Group()
  device.name = 'xQpRtZkWmNbVcLs'
  const body = new Mesh(
    new RoundedBoxGeometry(width + 0.006, height + 0.006, 0.008, 4, 0.01),
    new MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.9, roughness: 0.35 }),
  )
  const glass = new Mesh(
    new PlaneGeometry(width, height),
    new MeshStandardMaterial({ color: 0x000000, emissiveMap: new Texture() }),
  )
  glass.name = 'HkNSnYzBPABcqwM'
  glass.position.z = 0.0041
  device.add(body, glass)
  return device
}

/** Two sizes in one scene, the larger turned round the way Apple shows its back. */
export function syntheticProScene(): Group {
  const scene = new Group()
  const pro = phone(0.066, 0.144)
  pro.position.set(0.05, 0, 0)
  pro.rotation.set(Math.PI / 2, 0, 0)
  const max = phone(0.072, 0.158)
  max.position.set(-0.05, 0.01, -0.02)
  max.rotation.set(Math.PI / 2, Math.PI, 0)
  scene.add(pro, max)
  return scene
}

/** One phone, as most scenes carry. */
export function syntheticPhoneScene(): Group {
  const scene = new Group()
  scene.add(phone(0.066, 0.144))
  return scene
}

/** A tablet leaning back on a keyboard, both under one parent. */
export function syntheticTabletScene(): Group {
  const scene = new Group()
  const setup = new Group()
  const tablet = phone(0.197, 0.263)
  tablet.rotation.set(-0.35, 0, Math.PI / 2)
  tablet.position.set(0, 0.1, -0.03)
  const keyboard = new Mesh(new BoxGeometry(0.29, 0.01, 0.22), new MeshStandardMaterial({ color: 0x222222 }))
  keyboard.position.set(0, -0.02, 0.06)
  setup.add(tablet, keyboard)
  scene.add(setup)
  return scene
}
