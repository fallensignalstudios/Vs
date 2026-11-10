/**
 * Planar reflections for polished floors.
 *
 * One mirror plane at a time: of all registered floors inside the view frustum, the plane nearest below the
 * camera wins. The scene is rendered from the mirrored camera (oblique near plane = the floor, so nothing below
 * it leaks in) into a reduced-resolution HDR target with a mip chain; `reflectionShader.ts` samples it from the
 * floor materials. When no registered floor is visible the pass is skipped entirely.
 */
import * as THREE from 'three';
import type { ReflectiveFloorOpts } from '@/core/api';
import { RENDER_LAYERS } from '@/core/api';
import { patchFloorMaterial, type ReflectionGlobals, type ReflectionLocals } from './reflectionShader';

interface FloorEntry {
  mesh: THREE.Mesh;
  /** explicit plane height, or null = top of the world bounding box */
  y: number | null;
  box: THREE.Box3;
}

/** floor fragments within this distance (m) of the plane reflect; fades out by twice the distance */
const HEIGHT_TOLERANCE = 0.06;
/** the mirror clips this far above the plane so the floor's own top face never z-fights into the reflection */
const CLIP_BIAS = 0.004;
const FADE_RATE = 5;

export class PlanarReflections {
  readonly globals: ReflectionGlobals = {
    uReflOn: { value: 0 },
    uReflTex: { value: null },
    uReflDepth: { value: null },
    uReflProjInv: { value: new THREE.Matrix4() },
    uReflRowY: { value: new THREE.Vector4(0, 1, 0, 0) },
    uReflParams: { value: new THREE.Vector4(0, HEIGHT_TOLERANCE, 4, 360) },
    uReflInvRes: { value: new THREE.Vector2(1, 1) },
    uReflAxis: { value: new THREE.Vector2(0, 1) },
  };

  /** true when the mirror pass rendered this frame */
  active = false;

  private readonly floors = new Map<THREE.Mesh, FloorEntry>();
  private readonly mirror = new THREE.PerspectiveCamera();
  private target: THREE.WebGLRenderTarget | null = null;
  private width = 0;
  private height = 0;
  private activeY: number | null = null;
  private fade = 0;
  private warnedMaterial = false;
  private warnedMesh = false;

  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly point = new THREE.Vector3();

  /** MSAA samples of the mirror target (thin emissive seams survive the half-res pass) */
  samples = 0;

  constructor(private readonly hdr: boolean) {
    const m = this.mirror;
    m.matrixAutoUpdate = false;
    m.matrixWorldAutoUpdate = false;
    m.layers.set(RENDER_LAYERS.default);
  }

  get count(): number {
    return this.floors.size;
  }

  register(mesh: THREE.Mesh, opts: ReflectiveFloorOpts = {}): void {
    if (!mesh || (mesh as THREE.Mesh).isMesh !== true || !mesh.geometry) {
      if (!this.warnedMesh) {
        this.warnedMesh = true;
        console.warn('[render] registerReflectiveFloor: not a mesh — ignored');
      }
      return;
    }
    const y = typeof opts.y === 'number' && Number.isFinite(opts.y) ? opts.y : null;
    this.floors.set(mesh, { mesh, y, box: new THREE.Box3() });

    const strength = typeof opts.strength === 'number' && Number.isFinite(opts.strength) ? Math.max(0, opts.strength) : 1;
    const rough = typeof opts.roughness === 'number' && Number.isFinite(opts.roughness) ? Math.min(1, Math.max(0, opts.roughness)) : -1;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let any = false;
    for (const mat of mats) {
      if (!mat) continue;
      const locals: ReflectionLocals | null = patchFloorMaterial(mat, this.globals);
      if (!locals) continue;
      locals.uReflStrength.value = strength;
      locals.uReflRough.value = rough;
      any = true;
    }
    if (!any && !this.warnedMaterial) {
      this.warnedMaterial = true;
      console.warn('[render] registerReflectiveFloor: mesh has no MeshStandardMaterial — it keeps env-map reflections only');
    }
  }

  unregister(mesh: THREE.Mesh): void {
    this.floors.delete(mesh);
  }

  clear(): void {
    this.floors.clear();
    this.activeY = null;
    this.fade = 0;
    this.globals.uReflOn.value = 0;
  }

  /** Size of the main view's buffer in px and the mirror resolution scale (0.5 = half-res). */
  setSize(viewWidth: number, viewHeight: number, scale: number): void {
    this.globals.uReflInvRes.value.set(1 / Math.max(1, viewWidth), 1 / Math.max(1, viewHeight));
    const w = Math.max(8, Math.round(viewWidth * scale));
    const h = Math.max(8, Math.round(viewHeight * scale));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    if (this.target) this.target.setSize(w, h);
    this.globals.uReflParams.value.z = Math.max(0, Math.floor(Math.log2(h)) - 3);
    this.globals.uReflParams.value.w = h;
  }

  /** Stop sampling (env-map fallback) until the next render() — used around env bakes and when disabled. */
  suspend(): void {
    this.globals.uReflOn.value = 0;
    this.active = false;
  }

  /** Free the mirror target (quality dropped below 'high'). */
  release(): void {
    this.suspend();
    this.globals.uReflTex.value = null;
    this.globals.uReflDepth.value = null;
    if (this.target) {
      this.target.depthTexture?.dispose();
      this.target.dispose();
      this.target = null;
    }
    this.activeY = null;
    this.fade = 0;
  }

  /**
   * Pick the active plane and render the mirror pass. Call once per frame before the main view.
   * Returns true when the pass rendered.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number): boolean {
    const g = this.globals;
    this.active = false;
    if (this.floors.size === 0 || this.width === 0) {
      g.uReflOn.value = 0;
      return false;
    }

    if (camera.parent) camera.updateWorldMatrix(true, false);
    else camera.updateMatrixWorld();
    const camY = camera.matrixWorld.elements[13];
    const wanted = this.pickPlane(scene, camera, camY);

    if (wanted === null) {
      // nothing reflective on screen: no pass, and start clean when a floor comes back into view
      this.activeY = null;
      this.fade = 0;
      g.uReflOn.value = 0;
      return false;
    }
    const step = Math.min(1, Math.max(0, dt) * FADE_RATE);
    if (this.activeY === null) {
      // a floor just came into view (zone start, camera cut): no cross-fade needed
      this.activeY = wanted;
      this.fade = 1;
    } else if (Math.abs(wanted - this.activeY) > 0.02) {
      // the camera moved to another floor height: cross-fade through the env map
      this.fade = Math.max(0, this.fade - step);
      if (this.fade <= 0) this.activeY = wanted;
    } else {
      this.fade = Math.min(1, this.fade + step);
    }
    if (camY - this.activeY < 0.02) {
      g.uReflOn.value = 0;
      return false;
    }

    const target = this.ensureTarget();
    this.updateMirror(camera, this.activeY);

    // The mirror target must not be bound as a sampler while it is the draw target (floors at other heights
    // are part of this pass), and those floors must not try to sample it.
    g.uReflOn.value = 0;
    g.uReflTex.value = null;
    g.uReflDepth.value = null;

    const prevTarget = renderer.getRenderTarget();
    const shadow = renderer.shadowMap;
    const prevAuto = shadow.autoUpdate;
    const prevNeeds = shadow.needsUpdate;
    // reuse last frame's shadow maps: they are view independent, and the main pass refreshes them right after
    shadow.autoUpdate = false;
    shadow.needsUpdate = false;
    try {
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderer.render(scene, this.mirror);
    } finally {
      renderer.setRenderTarget(prevTarget);
      shadow.autoUpdate = prevAuto;
      shadow.needsUpdate = prevNeeds;
    }

    const e = camera.matrixWorld.elements;
    g.uReflRowY.value.set(e[1], e[5], e[9], e[13]);
    g.uReflParams.value.x = this.activeY;
    // screen direction of world up = xy of the view-space up vector; mirrored in x like the texture
    const v = camera.matrixWorldInverse.elements;
    const ux = v[4];
    const uy = v[5];
    const len = Math.hypot(ux, uy);
    if (len > 1e-3) g.uReflAxis.value.set(-ux / len, uy / len);
    else g.uReflAxis.value.set(0, 1);
    g.uReflTex.value = target.texture;
    g.uReflDepth.value = target.depthTexture;
    g.uReflOn.value = this.fade;
    this.active = true;
    return true;
  }

  // -----------------------------------------------------------------------------------------------------

  /** Height of the nearest registered plane below the camera that is inside the frustum, or null. */
  private pickPlane(scene: THREE.Scene, camera: THREE.Camera, camY: number): number | null {
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    let best: number | null = null;
    let bestDist = Infinity;
    for (const entry of this.floors.values()) {
      const mesh = entry.mesh;
      // detached meshes are skipped, not dropped: zones register floors before their root joins the scene
      if (!attachedAndVisible(mesh, scene)) continue;
      const geo = mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      if (!geo.boundingBox) continue;
      // this runs before the frame's scene traversal: a floor added or moved since the last frame still has
      // a stale world matrix, which would put the mirror at the wrong height for a frame
      mesh.updateWorldMatrix(true, false);
      entry.box.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
      if (!this.frustum.intersectsBox(entry.box)) continue;
      const y = entry.y ?? entry.box.max.y;
      const d = camY - y;
      if (d < 0.05 || d >= bestDist) continue;
      bestDist = d;
      best = y;
    }
    return best;
  }

  private ensureTarget(): THREE.WebGLRenderTarget {
    if (this.target) return this.target;
    const depthTexture = new THREE.DepthTexture(this.width, this.height);
    depthTexture.name = 'Reflection.Depth';
    const target = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: this.samples,
    });
    target.texture.name = 'Reflection.Color';
    this.target = target;
    return target;
  }

  /** Mirror camera = main camera reflected about y = planeY, flipped in X so it stays right-handed. */
  private updateMirror(camera: THREE.Camera, planeY: number): void {
    const m = this.mirror;
    const e = camera.matrixWorld.elements;
    const o = m.matrixWorld.elements;
    o[0] = -e[0]; o[1] = e[1]; o[2] = -e[2]; o[3] = 0;
    o[4] = e[4]; o[5] = -e[5]; o[6] = e[6]; o[7] = 0;
    o[8] = e[8]; o[9] = -e[9]; o[10] = e[10]; o[11] = 0;
    o[12] = e[12]; o[13] = 2 * planeY - e[13]; o[14] = e[14]; o[15] = 1;
    m.matrix.copy(m.matrixWorld);
    m.matrixWorldInverse.copy(m.matrixWorld).invert();
    m.projectionMatrix.copy(camera.projectionMatrix);
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) {
      m.near = pc.near;
      m.far = pc.far;
      m.fov = pc.fov;
      m.aspect = pc.aspect;
    }

    // Oblique near plane (Lengyel): clip everything below the floor.
    this.point.set(0, planeY + CLIP_BIAS, 0);
    this.plane.setFromNormalAndCoplanarPoint(this.up, this.point).applyMatrix4(m.matrixWorldInverse);
    const p = m.projectionMatrix.elements;
    const clip = this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const q = this.q;
    q.x = (Math.sign(clip.x) + p[8]) / p[0];
    q.y = (Math.sign(clip.y) + p[9]) / p[5];
    q.z = -1;
    q.w = (1 + p[10]) / p[14];
    const d = clip.dot(q);
    if (Math.abs(d) > 1e-8) {
      clip.multiplyScalar(2 / d);
      p[2] = clip.x;
      p[6] = clip.y;
      p[10] = clip.z + 1;
      p[14] = clip.w;
    }
    m.projectionMatrixInverse.copy(m.projectionMatrix).invert();
    this.globals.uReflProjInv.value.copy(m.projectionMatrixInverse);
  }
}

function attachedAndVisible(o: THREE.Object3D, scene: THREE.Scene): boolean {
  let n: THREE.Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    if (n === scene) return true;
    n = n.parent;
  }
  return false;
}
