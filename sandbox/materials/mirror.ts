/**
 * Sandbox stand-in for the renderer's reflective-floor injection (the real one lives in render-core).
 *
 * It renders the scene from the camera mirrored in a horizontal plane and injects the result into floor
 * materials BY ASSIGNING `material.onBeforeCompile` — exactly how another subsystem would — which exercises the
 * material library's hook chaining: the library's own triplanar patch must keep working underneath.
 */
import * as THREE from 'three';

export interface FloorMirror {
  /** inject the planar reflection into this floor mesh's material (unique material instance recommended) */
  register(mesh: THREE.Mesh, strength?: number): void;
  /** render the mirrored view; call once per frame before the main render */
  update(): void;
}

export function createFloorMirror(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, y = 0): FloorMirror {
  const target = new THREE.WebGLRenderTarget(640, 360, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const mirrorCam = new THREE.PerspectiveCamera();
  const matrix = { value: new THREE.Matrix4() };
  const tex = { value: target.texture };
  const floors: THREE.Mesh[] = [];
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3();

  return {
    register(mesh, strength = 1) {
      floors.push(mesh);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const k = { value: strength };
      // a plain assignment, as any other subsystem would do it
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.mirrorTex = tex;
        shader.uniforms.mirrorMatrix = matrix;
        shader.uniforms.mirrorStrength = k;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vMirrorUv;\nuniform mat4 mirrorMatrix;')
          .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMirrorUv = mirrorMatrix * modelMatrix * vec4( transformed, 1.0 );');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vMirrorUv;\nuniform sampler2D mirrorTex;\nuniform float mirrorStrength;')
          .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
{
	vec2 mUv = vMirrorUv.xy / vMirrorUv.w + ( normal.xy - nonPerturbedNormal.xy ) * 0.35;
	vec3 mRefl = textureLod( mirrorTex, mUv, material.roughness * 9.0 ).rgb;
	vec3 mBrdf = EnvironmentBRDF( geometryNormal, geometryViewDir, material.specularColorBlended, material.specularF90, material.roughness );
	float mW = mirrorStrength * ( 1.0 - smoothstep( 0.25, 0.6, material.roughness ) );
	reflectedLight.indirectSpecular = mix( reflectedLight.indirectSpecular, mRefl * mBrdf, mW );
}`);
      };
    },
    update() {
      if (!floors.length) return;
      camera.updateMatrixWorld();
      pos.setFromMatrixPosition(camera.matrixWorld);
      camera.getWorldDirection(look).add(pos);
      up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      pos.y = 2 * y - pos.y; look.y = 2 * y - look.y; up.y = -up.y;
      mirrorCam.fov = camera.fov; mirrorCam.aspect = camera.aspect; mirrorCam.near = camera.near; mirrorCam.far = camera.far;
      mirrorCam.position.copy(pos); mirrorCam.up.copy(up); mirrorCam.lookAt(look);
      mirrorCam.updateProjectionMatrix(); mirrorCam.updateMatrixWorld();
      matrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
        .multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
      for (const f of floors) f.visible = false;
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, mirrorCam);
      renderer.setRenderTarget(prevTarget);
      for (const f of floors) f.visible = true;
    },
  };
}
