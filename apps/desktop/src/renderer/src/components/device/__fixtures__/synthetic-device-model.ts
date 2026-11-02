import {
  AnimationClip,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Texture,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
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

const glassMaterial = () => new MeshStandardMaterial({ color: 0x000000, emissiveMap: new Texture() })

/**
 * A book-style foldable the way Xcode's iPhone Duo arrives: one skinned inner glass
 * across two hinge bones, a cover glass on the back of the left half, and one baked
 * clip from open (0s) to closed (1s). The inner glass is mapped as it is seen,
 * landscape, over a portrait framebuffer.
 */
export function syntheticFoldableScene(): Group {
  const half = 0.075
  const height = 0.105
  const hinge = new Bone()
  hinge.name = 'qWzHnTrBvKxMpLa'
  const left = new Bone()
  left.name = 'LfTgYhUjIkOlPmN'
  const right = new Bone()
  right.name = 'RgHyJuKiLoPmNbV'
  hinge.add(left, right)

  // Three columns of vertices: the left edge, the hinge, the right edge.
  const geometry = new PlaneGeometry(half * 2, height, 2, 1)
  const position = geometry.getAttribute('position')
  const indices: number[] = []
  const weights: number[] = []
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    indices.push(x < 0 ? 1 : x > 0 ? 2 : 1, x === 0 ? 2 : 0, 0, 0)
    weights.push(x === 0 ? 0.5 : 1, x === 0 ? 0.5 : 0, 0, 0)
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  const inner = new SkinnedMesh(geometry, glassMaterial())
  inner.name = 'mQHVkATpIwJRVQx'
  inner.position.z = 0.0041
  inner.add(hinge)
  inner.bind(new Skeleton([hinge, left, right]))

  const body = (side: -1 | 1, bone: Bone) => {
    const shell = new Mesh(
      new BoxGeometry(half, height + 0.004, 0.008),
      new MeshStandardMaterial({ color: 0xd6d0c4, metalness: 0.8, roughness: 0.35 }),
    )
    shell.position.set((side * half) / 2, 0, -0.0041)
    bone.add(shell)
  }
  body(-1, left)
  body(1, right)
  const cover = new Mesh(new PlaneGeometry(half - 0.006, height - 0.006), glassMaterial())
  cover.name = 'zaWsadDZpWAUDAX'
  cover.position.set(-half / 2, 0, -0.0083)
  cover.rotation.y = Math.PI
  left.add(cover)

  // Closing a book: each half turns a quarter about the hinge, towards the viewer.
  const turn = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle).toArray()
  const clip = new AnimationClip('Animation', 1, [
    new QuaternionKeyframeTrack(`${left.name}.quaternion`, [0, 1], [...turn(0), ...turn(Math.PI / 2)]),
    new QuaternionKeyframeTrack(`${right.name}.quaternion`, [0, 1], [...turn(0), ...turn(-Math.PI / 2)]),
  ])
  const scene = new Group()
  scene.add(inner)
  scene.animations = [clip]
  return scene
}

/**
 * The Duo's own arrangement, unlike the parented book above. The cover is skinned to
 * one joint, the other half of the inner glass to another, and a hinge joint sits
 * beside them under the same parent. Only the plain half is keyed.
 */
export function syntheticSkinnedFoldableScene(): Group {
  const spine = new Bone()
  spine.name = 'SpnRootJoint'
  const coverBone = new Bone()
  coverBone.name = 'CvrHalfJoint'
  const plainBone = new Bone()
  plainBone.name = 'PlnHalfJoint'
  const strip = new Bone()
  strip.name = 'HngStripJoint'
  spine.add(coverBone, plainBone, strip)

  const sheet = (name: string, width: number, height: number, widthSegments: number, jointAt: (x: number) => number) => {
    const geometry = new PlaneGeometry(width, height, widthSegments, 1)
    const position = geometry.getAttribute('position')
    const indices: number[] = []
    const weights: number[] = []
    for (let i = 0; i < position.count; i++) {
      indices.push(jointAt(position.getX(i)), 0, 0, 0)
      weights.push(1, 0, 0, 0)
    }
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4))
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
    const mesh = new SkinnedMesh(geometry, glassMaterial())
    mesh.name = name
    return mesh
  }
  // The cover is the smaller sheet, so it is chosen as the cover. On the inner sheet
  // the positive-x columns outweigh the cover's joint.
  const cover = sheet('coverGlass', 0.06, 0.09, 1, () => 0)
  const inner = sheet('innerGlass', 0.15, 0.105, 4, (x) => (x < 0 ? 0 : 1))
  const scene = new Group()
  scene.add(inner, cover)
  inner.add(spine)
  scene.updateMatrixWorld(true)
  inner.bind(new Skeleton([coverBone, plainBone, strip]))
  cover.bind(new Skeleton([coverBone]))

  const turn = (angle: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle).toArray()
  scene.animations = [new AnimationClip('Animation', 1, [
    new QuaternionKeyframeTrack('PlnHalfJoint.quaternion', [0, 1], [...turn(0), ...turn(-Math.PI / 2)]),
  ])]
  return scene
}
