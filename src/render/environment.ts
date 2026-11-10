/**
 * Image-based lighting: bakes `scene.environment` (PMREM) from the sky plus a dim fill tinted by the look's
 * ambient colours, so polished metal and stone always have something to reflect. Optionally captures the
 * live scene as a local reflection probe (zone geometry, emissive strips).
 */
import * as THREE from 'three';

export interface EnvBakeRequest {
  /** the game scene (only rendered when `captureScene`) */
  scene: THREE.Scene;
  /** sky root to include, or null (stub / missing) */
  sky: THREE.Object3D | null;
  /** linear RGB */
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  ambientIntensity: number;
  captureScene: boolean;
  position: THREE.Vector3;
  near: number;
  far: number;
}

const fillVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fillFrag = /* glsl */ `
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uGain;
uniform float uFloor;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 c = mix(uGround, uSky, smoothstep(-0.35, 0.5, h));
  // broad overhead lobe: a soft "ceiling" so polished metal always has a highlight to catch
  float lobe = pow(max(h, 0.0), 4.0);
  c += uSky * 1.6 * lobe;
  // neutral floor (strongest overhead) so no metal ever reflects pure black, whatever the look
  gl_FragColor = vec4(c * uGain + vec3(1.0, 0.96, 0.9) * uFloor * (0.3 + lobe), 1.0);
}`;

export class EnvironmentBaker {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private readonly fill: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private target: THREE.WebGLRenderTarget | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene.background = new THREE.Color(0x000000);
    this.fill = new THREE.Mesh(
      new THREE.SphereGeometry(40, 32, 16),
      new THREE.ShaderMaterial({
        name: 'EnvFill',
        vertexShader: fillVert,
        fragmentShader: fillFrag,
        uniforms: {
          uSky: { value: new THREE.Color() },
          uGround: { value: new THREE.Color() },
          uGain: { value: 0.25 },
          uFloor: { value: 0.012 },
        },
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.fill.name = 'EnvFill';
    this.fill.frustumCulled = false;
    this.fill.renderOrder = 1e6;
    this.fill.userData.treatAsOpaque = true;
  }

  /** The current environment texture (null before the first bake). */
  get texture(): THREE.Texture | null {
    return this.target ? this.target.texture : null;
  }

  /**
   * Bake and return the new environment texture. The previous target is released.
   * Never throws: on failure the previous environment is kept and returned.
   */
  bake(req: EnvBakeRequest): THREE.Texture | null {
    const u = this.fill.material.uniforms;
    (u.uSky.value as THREE.Color).copy(req.skyColor);
    (u.uGround.value as THREE.Color).copy(req.groundColor);
    // Fill radiance relative to the hemisphere light: bright enough to read on metal, dim enough that the
    // sky and the scene's own emissives dominate.
    u.uGain.value = 0.25 * Math.max(0, req.ambientIntensity) + 0.05;

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevNeeds = renderer.shadowMap.needsUpdate;
    let next: THREE.WebGLRenderTarget | null = null;
    try {
      if (req.captureScene) {
        next = this.captureScene(req);
      } else {
        next = this.captureSky(req);
      }
    } catch (err) {
      console.warn('[render] environment bake failed — keeping the previous environment', err);
      next = null;
    } finally {
      renderer.shadowMap.autoUpdate = prevAuto;
      renderer.shadowMap.needsUpdate = prevNeeds;
      renderer.setRenderTarget(prevTarget);
    }
    if (next) {
      const old = this.target;
      this.target = next;
      if (old) old.dispose();
    }
    return this.texture;
  }

  private captureSky(req: EnvBakeRequest): THREE.WebGLRenderTarget {
    const { sky } = req;
    const env = this.envScene;
    const parent = sky ? sky.parent : null;
    const index = parent ? parent.children.indexOf(sky as THREE.Object3D) : -1;
    this.fill.position.set(0, 0, 0);
    env.add(this.fill);
    if (sky) env.add(sky);
    try {
      return this.pmrem.fromScene(env, 0, req.near, req.far);
    } finally {
      env.remove(this.fill);
      if (sky) {
        env.remove(sky);
        if (parent) {
          parent.add(sky);
          // restore the original child order (draw order of equal-renderOrder objects depends on it)
          const at = parent.children.indexOf(sky);
          if (index >= 0 && at >= 0 && at !== index) {
            parent.children.splice(at, 1);
            parent.children.splice(Math.min(index, parent.children.length), 0, sky);
          }
        }
      }
    }
  }

  private captureScene(req: EnvBakeRequest): THREE.WebGLRenderTarget {
    const renderer = this.renderer;
    const scene = req.scene;
    // one shadow update for the first cube face, none for the other five
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    this.fill.position.copy(req.position);
    scene.add(this.fill);
    try {
      return this.pmrem.fromScene(scene, 0.035, req.near, req.far, { position: req.position });
    } finally {
      scene.remove(this.fill);
    }
  }
}
