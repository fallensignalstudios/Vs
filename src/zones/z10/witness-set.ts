/**
 * Z10 — the Witness V set: a King-era bridge remembered in white-gold, the whole blue-white star beyond its
 * forward glass, the sundering (two unequal remnants and the Wound between them), the King and his chronicler,
 * and the white-gold portal of the King's own age that opens on the bridge (the author's ruling 6).
 *
 * The set is built hidden around the dais (the protagonists stand at the dais front, unseen; the two historical
 * figures are visuals only). While the Witness plays every other object of the zone is hidden, so "the chamber
 * disappears". Everything animates from targets in `W` on the sim clock and snaps on a skip.
 */
import * as THREE from 'three';
import type { HumanoidVisual, ZoneBuilder, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api/chars';
import { C, DAIS_H } from './state';

/** the bridge floor height (the dais top, where the two watchers stand) */
const FLOOR = DAIS_H;
/** star: bearing from the dais, distance and radius */
const STAR = { dist: 1800, radius: 470, el: 13 } as const;

export interface Figure {
  visual: HumanoidVisual | null;
  /** plan target the figure walks to; null = stand */
  target: THREE.Vector3 | null;
  speed: number;
  yaw: number;
  /** polish 4: when standing, turn to face this figure (the King and his chronicler talk to each other) */
  look: Figure | null;
}

export interface WitnessSet {
  group: THREE.Group;
  star: THREE.Mesh;
  halo: THREE.Mesh;
  red: THREE.Mesh;
  white: THREE.Mesh;
  wound: THREE.Mesh;
  portal: THREE.Group;
  portalInner: THREE.Mesh;
  /** the memory's sky: a silver haze instead of a starfield (polish 4) */
  dome: THREE.Mesh;
  blade: THREE.Mesh;
  king: Figure;
  vesryn: Figure;
  /** targets (0..1) and their eased values */
  tgt: { star: number; sunder: number; wound: number; portal: number; blade: number };
  cur: { star: number; sunder: number; wound: number; portal: number; blade: number };
  owned: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture>;
}

const P = (b: ZoneBuilder, dx: number, dn: number, h = FLOOR): THREE.Vector3 => b.P(C.x + dx, C.n + dn, h);

/** a direction from the dais toward a sky point: azimuth (0 = north, + = east) and elevation, degrees */
function skyDir(azDeg: number, elDeg: number): THREE.Vector3 {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

/** value noise + fbm shared by the memory's shaders (cheap: the sky, the star and the Wound are each one draw) */
const GLSL_MEMORY_NOISE = /* glsl */ `
  float hash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 45.164 ) ) ) * 43758.5453 ); }
  float vnoise( vec3 p ) {
    vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mix( hash( i ), hash( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash( i + vec3( 0, 1, 0 ) ), hash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( hash( i + vec3( 0, 0, 1 ) ), hash( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash( i + vec3( 0, 1, 1 ) ), hash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
  }
  // octaves on a rotated lattice (no square value-noise contours)
  const mat3 MROT = mat3( 0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64 );
  float fbm4( vec3 p ) {
    float s = 0.0, a = 0.5;
    for ( int i = 0; i < 4; i++ ) { s += a * vnoise( p ); p = MROT * p * 2.03 + 17.1; a *= 0.5; }
    return s / 0.9375;
  }
`;

/**
 * Witness V is remembered, not seen: the bridge stands in a silver memory of a sky (fix & ship: depth instead of a flat
 * grey void, after the crownmark painting's backdrop). A vertical gradient — a luminous band of haze over the horizon
 * deepening to a slate zenith — with banks of cloud lying low in it, lit along their rims; distant, pale, curved
 * spires standing out of the haze on both flanks and two great arcs high up, all of it desaturated silver. The whole
 * blue-white star floods it with light; when the star tears, its light goes out of the haze — red to the west, hard
 * white to the east. Linear HDR out (the post chain grades and tone-maps it); fog-free; drawn behind everything
 * (radius 3200, inside the far plane); one draw call.
 */
function memoryDome(own: <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T) => T, starDir: THREE.Vector3): THREE.Mesh {
  const mat = own(new THREE.ShaderMaterial({
    uniforms: { uDir: { value: starDir.clone().normalize() }, uStar: { value: 1 }, uSunder: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uDir;
      uniform float uStar;
      uniform float uSunder;
      uniform float uTime;
      varying vec3 vDir;
      ${GLSL_MEMORY_NOISE}
      // a tall curved spire rising out of the haze: base azimuth, height and base half-width (radians), lean (its tip
      // drifts by lean radians of azimuth); returns coverage and, in edge, how near its star-side edge the point is
      float spire( float az, float el, float az0, float h, float w, float lean, out float edge ) {
        float t = clamp( el / h, 0.0, 1.0 );
        float c = az0 + lean * t * t;
        float hw = w * 1.3 * pow( 1.0 - t, 0.9 ) + 0.002;
        float da = az - c;
        float aa = max( fwidth( az ) * 1.5, 0.0015 );
        float m = ( 1.0 - smoothstep( hw - aa, hw + aa, abs( da ) ) ) * smoothstep( -0.03, 0.0, el ) * ( 1.0 - smoothstep( h - 0.02, h, el ) );
        // the side facing the star (azimuth 0) catches its light
        edge = smoothstep( hw * 0.35, hw, -da * sign( c + 1e-4 ) ) * m;
        return m;
      }
      void main() {
        vec3 d = normalize( vDir );
        float el = asin( clamp( d.y, -1.0, 1.0 ) );
        float az = atan( d.x, -d.z );
        float up = clamp( d.y, 0.0, 1.0 );
        // the vertical gradient: luminous haze over the horizon, deepening to a slate zenith
        vec3 col = mix( vec3( 0.165, 0.17, 0.185 ), vec3( 0.07, 0.074, 0.088 ), smoothstep( 0.0, 0.3, up ) );
        col = mix( col, vec3( 0.02, 0.023, 0.032 ), smoothstep( 0.3, 0.95, up ) );
        // high thin veils drifting across it
        float veil = fbm4( d * vec3( 1.7, 4.2, 1.7 ) + vec3( uTime * 0.003, 9.0, 0.0 ) );
        col *= 0.8 + 0.4 * veil;
        // two great pale arcs far out in the haze, high over the bridge
        float arc1 = 1.0 - smoothstep( 0.0, 0.006, abs( dot( d, normalize( vec3( 0.0, 0.42, 1.0 ) ) ) - 0.5 ) );
        float arc2 = 1.0 - smoothstep( 0.0, 0.004, abs( dot( d, normalize( vec3( 0.55, 0.3, 1.0 ) ) ) - 0.62 ) );
        float arcs = max( arc1, 0.7 * arc2 ) * smoothstep( 0.12, 0.35, up ) * ( 1.0 - smoothstep( 0.75, 0.95, up ) );
        col = mix( col, vec3( 0.2, 0.203, 0.215 ), arcs * 0.45 );
        // distant curved spires standing out of the haze on both flanks, bowing inward toward the star
        float e = 0.0, et = 0.0, sp = 0.0, m;
        m = spire( az, el, -0.46, 0.66, 0.030, 0.09, et ); sp = max( sp, m ); e = max( e, et );
        m = spire( az, el, 0.50, 0.58, 0.026, -0.08, et ); sp = max( sp, m ); e = max( e, et );
        m = spire( az, el, -0.80, 0.80, 0.042, 0.14, et ); sp = max( sp, m ); e = max( e, et );
        m = spire( az, el, 0.86, 0.74, 0.038, -0.13, et ); sp = max( sp, m ); e = max( e, et );
        m = spire( az, el, -1.22, 0.52, 0.030, 0.07, et ); sp = max( sp, m ); e = max( e, et );
        m = spire( az, el, 1.30, 0.60, 0.034, -0.09, et ); sp = max( sp, m ); e = max( e, et );
        m = spire( az, el, -1.75, 0.70, 0.040, 0.10, et ); sp = max( sp, m ); e = max( e, et );
        m = spire( az, el, 1.85, 0.66, 0.036, -0.10, et ); sp = max( sp, m ); e = max( e, et );
        // pale stone dissolving into the haze toward its base, its star-side edge lit
        float lit = 0.6 * uStar * ( 1.0 - uSunder ) + 0.25;
        vec3 stone = vec3( 0.16, 0.162, 0.17 ) + vec3( 0.2, 0.205, 0.22 ) * e * lit;
        col = mix( col, stone, sp * mix( 0.4, 0.9, smoothstep( 0.02, 0.4, el ) ) );
        // the luminous cloudy backdrop: banks of cloud lying low in the sky, in front of the spires' feet, lit along
        // their rims (brightest toward the star)
        float n = fbm4( d * vec3( 2.6, 7.0, 2.6 ) + vec3( uTime * 0.006, 0.0, 0.0 ) );
        float bank = smoothstep( -0.04, 0.06, d.y ) * ( 1.0 - smoothstep( 0.22, 0.55, d.y ) );
        float body = smoothstep( 0.44, 0.62, n ) * bank;
        float rim = ( smoothstep( 0.40, 0.50, n ) - smoothstep( 0.52, 0.66, n ) ) * bank;
        float toStar = pow( max( dot( d, uDir ), 0.0 ), 3.0 );
        col = mix( col, col * 0.4 + vec3( 0.014, 0.015, 0.02 ), body * 0.88 );
        col += vec3( 0.22, 0.225, 0.24 ) * rim * ( 0.5 + 1.2 * toStar * uStar * ( 1.0 - uSunder ) );
        // below the horizon: a pale mist floor
        col = mix( col, vec3( 0.085, 0.088, 0.098 ), smoothstep( 0.0, -0.3, d.y ) );
        // the whole star floods the haze round it with blue-white light (held back: the star keeps its form)
        float s = max( dot( d, uDir ), 0.0 );
        col += vec3( 0.6, 0.76, 1.0 ) * ( pow( s, 24.0 ) * 0.28 + pow( s, 4.0 ) * 0.05 ) * uStar;
        // torn: the light goes out of the haze; red bleeds from the west, a hard white from the east
        float k = uSunder;
        col *= 1.0 - 0.42 * k;
        col += vec3( 0.55, 0.12, 0.05 ) * pow( max( -d.x, 0.0 ), 3.0 ) * smoothstep( 0.6, 0.0, abs( d.y - 0.2 ) ) * k;
        col += vec3( 0.7, 0.72, 0.78 ) * pow( max( d.x, 0.0 ), 6.0 ) * smoothstep( 0.5, 0.0, abs( d.y - 0.15 ) ) * k * 0.6;
        gl_FragColor = vec4( col, 1.0 );
      }`,
    side: THREE.BackSide, fog: false,
  }));
  const dome = new THREE.Mesh(own(new THREE.SphereGeometry(3200, 48, 24)), mat);
  dome.name = 'z10-witness-dome';
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  return dome;
}

/**
 * The whole star (fix & ship): a limb-darkened, granulated blue-white disc instead of a flat HDR fill, at an intensity
 * the Witness's bloom does not blow to white — it keeps its form (a bright core, a darker limb, a mottled face).
 */
function starMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uGain: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vObj;
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        vN = normalize( mat3( modelMatrix ) * normal );
        vView = normalize( cameraPosition - w.xyz );
        vObj = normalize( position );
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vView;
      varying vec3 vObj;
      ${GLSL_MEMORY_NOISE}
      void main() {
        float mu = clamp( dot( normalize( vN ), normalize( vView ) ), 0.0, 1.0 );
        // limb darkening, then a granulated face with brighter faculae drifting slowly
        float limb = 0.32 + 0.68 * pow( mu, 0.55 );
        float g = fbm4( vObj * 7.0 + vec3( 0.0, uTime * 0.01, 0.0 ) );
        float fac = smoothstep( 0.58, 0.75, fbm4( vObj * 2.6 + 31.0 ) );
        float face = ( 0.82 + 0.3 * ( g - 0.5 ) + 0.22 * fac ) * limb;
        vec3 c = mix( vec3( 0.55, 0.68, 0.95 ), vec3( 0.86, 0.93, 1.0 ), smoothstep( 0.2, 0.9, mu ) );
        gl_FragColor = vec4( c * face * 1.2 * uGain, 1.0 );
      }`,
    fog: false,
  });
}

/**
 * The Wound in the memory (fix & ship): the sky's soft vortex, not a hard black disc — a near-black void with a
 * wandering soft edge, a grey-lavender crust of smoke and ink-dark rock streaked along a slow spiral, breaking up
 * into smoke outward, and a few faint violet glints. Transparent, fog-free, one quad facing the bridge.
 */
function woundMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpen;
      varying vec2 vUv;
      ${GLSL_MEMORY_NOISE}
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length( p ) * 2.2;          // 1 = the void's edge
        float a = atan( p.y, p.x );
        // spiral coordinates: the crust is dragged round and in
        float sw = a + 1.6 / max( r, 0.25 ) + uTime * 0.03;
        vec3 q = vec3( cos( sw ) * r, sin( sw ) * r, r * 0.8 );
        float wob = fbm4( vec3( cos( a ) * 1.5, sin( a ) * 1.5, 3.0 + uTime * 0.01 ) );
        float edge = 1.0 + 0.12 * ( wob - 0.5 );
        float aa = max( fwidth( r ) * 1.5, 0.004 );
        // the void: near-black, faint grooves just inside its rim
        float inside = 1.0 - smoothstep( edge - 0.06 - aa, edge + 0.04 + aa, r );
        float groove = 0.5 + 0.5 * sin( r * 46.0 + 3.0 * wob );
        vec3 voidC = vec3( 0.006, 0.006, 0.009 ) * ( 1.0 + 1.4 * smoothstep( 0.6, 1.0, r ) * groove );
        // the crust: smoke and rock from the rim out to ≈ 2 radii, thinning into smoke
        float n = fbm4( q * 2.4 + 5.0 );
        float fine = fbm4( q * 6.5 + 11.0 );
        float out1 = smoothstep( edge - 0.05, edge + 0.25, r );
        // lit from the upper left (where the red remnant's light and the star's last light fall), as in the sky: the crust
        // reaches furthest and is brightest there, short and dim on the lower right
        float lit = 0.5 + 0.5 * dot( p / max( length( p ), 1e-4 ), vec2( -0.707, 0.707 ) );
        float reach = 1.0 - smoothstep( 1.05 + 0.45 * lit, 1.7 + 0.55 * lit, r + 0.5 * ( n - 0.5 ) );
        float matter = smoothstep( 0.38, 0.6, n + 0.25 * ( fine - 0.5 ) ) * out1 * reach;
        float lum = ( 0.04 + 0.13 * smoothstep( 0.4, 0.8, fine ) * ( 1.0 - smoothstep( 1.0, 2.0, r ) ) ) * ( 0.45 + 0.75 * lit );
        vec3 smoke = mix( vec3( 0.07, 0.068, 0.078 ), vec3( 0.2, 0.19, 0.23 ), smoothstep( 0.06, 0.16, lum ) ) * ( lum / 0.12 );
        // ink-dark rock fused into it (soft-edged, never cut out)
        float ink = smoothstep( 0.6, 0.68, fine + 0.3 * ( n - 0.5 ) ) * out1 * ( 1.0 - smoothstep( 1.4, 1.9, r ) );
        vec3 crust = mix( smoke, vec3( 0.01, 0.01, 0.013 ), ink * 0.9 );
        // faint violet glints in the crust near the rim
        float gl = smoothstep( 0.78, 0.86, vnoise( q * 18.0 + 3.0 ) ) * matter * ( 1.0 - smoothstep( 1.0, 1.5, r ) );
        crust += vec3( 0.35, 0.24, 0.6 ) * gl * 0.5;
        vec3 col = mix( crust, voidC, inside );
        float alpha = max( inside, max( matter * 0.92, ink * 0.95 ) );
        // a soft outer veil of smoke round all of it
        alpha = max( alpha, 0.35 * smoothstep( 2.2, 1.2, r ) * smoothstep( 0.3, 0.6, n ) );
        gl_FragColor = vec4( col, alpha * uOpen );
      }`,
    transparent: true, depthWrite: false, fog: false,
  });
}

export function buildWitnessSet(b: ZoneBuilder): WitnessSet {
  const game = b.game;
  const mats = game.mats;
  const owned: WitnessSet['owned'] = [];
  const own = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T): T => {
    owned.push(x);
    return x;
  };
  const group = new THREE.Group();
  group.name = 'z10-witness';
  group.visible = false;

  // --- the bridge: a pale wet marble floor with fine inlaid gold rings (polish 4: a luminous silver-white memory
  // space — no glowing tubes, no sepia), the forward glass as a curved colonnade of frames ---
  const floorMat = b.surfaceMaterial?.('wet') ?? mats.get('whiteGoldFloor');
  const floor = new THREE.Mesh(own(new THREE.CircleGeometry(15, 64)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(P(b, 0, 2, FLOOR + 0.012));
  group.add(floor);
  // the inlay is built by the kit into the zone root; it moves into the (hidden) set
  group.add(b.inlay({ x: C.x, n: C.n + 2, h: FLOOR + 0.016, kind: 'rose', r: 13.5, count: 3, inner: 1 / 3, points: 5, width: 0.045, glow: 0.25 }));
  const frameMat = mats.get('whiteGold');
  const trim = mats.get('goldTrim');
  const post = own(new THREE.BoxGeometry(0.55, 15, 0.7));
  const beam = own(new THREE.BoxGeometry(1, 0.6, 0.8));
  const seam = own(new THREE.BoxGeometry(0.06, 13, 0.06));
  const seamMat = trim; // polish 4: fine gold, not an emissive strip
  const glassR = 13;
  const posts: THREE.Vector3[] = [];
  for (let i = -4; i <= 4; i++) {
    const a = (i * 13 * Math.PI) / 180;
    const p = P(b, Math.sin(a) * glassR, 2 + Math.cos(a) * glassR, FLOOR + 7.5);
    posts.push(p);
    const m = new THREE.Mesh(post, frameMat);
    m.position.copy(p);
    m.rotation.y = -a;
    group.add(m);
    const s = new THREE.Mesh(seam, seamMat);
    s.position.copy(p).add(new THREE.Vector3(Math.sin(a) * -0.4, 0, Math.cos(a) * 0.4));
    s.rotation.y = -a;
    group.add(s);
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i];
    const c = posts[i + 1];
    const m = new THREE.Mesh(beam, trim);
    m.position.copy(a).lerp(c, 0.5).setY(FLOOR + 14.8);
    m.scale.x = a.distanceTo(c);
    m.rotation.y = Math.atan2(-(c.z - a.z), c.x - a.x);
    group.add(m);
    const sill = new THREE.Mesh(beam, frameMat);
    sill.position.copy(a).lerp(c, 0.5).setY(FLOOR + 0.5);
    sill.scale.set(a.distanceTo(c), 1.6, 1);
    sill.rotation.y = m.rotation.y;
    group.add(sill);
  }
  // consoles of the bridge crew (empty: the officers and the engineer are voices) — a stepped plinth, a slanted
  // reading slab with a gold edge and a lit face, so they read as consoles rather than blocks
  const plinth = own(new THREE.BoxGeometry(1.7, 0.86, 0.5));
  const foot = own(new THREE.BoxGeometry(2.1, 0.12, 0.8));
  const slab = own(new THREE.BoxGeometry(2.2, 0.1, 0.78));
  const lip = own(new THREE.BoxGeometry(2.24, 0.03, 0.03));
  const face = own(new THREE.PlaneGeometry(1.9, 0.5));
  const faceMat = mats.emissive(0xffe6b8, 1.8);
  const tilt = -0.36;
  for (const [dx, dn, yaw] of [[-7, 5, 0.6], [7, 5, -0.6], [-9.5, 0, 1.2], [9.5, 0, -1.2]] as const) {
    const g = new THREE.Group();
    g.position.copy(P(b, dx, dn, FLOOR));
    g.rotation.y = yaw;
    const f = new THREE.Mesh(foot, frameMat);
    f.position.y = 0.06;
    const p = new THREE.Mesh(plinth, frameMat);
    p.position.y = 0.55;
    const top = new THREE.Group();
    top.position.set(0, 1.0, 0);
    top.rotation.x = tilt;
    const sl = new THREE.Mesh(slab, frameMat);
    const e = new THREE.Mesh(lip, trim);
    e.position.set(0, 0.03, 0.39);
    const lit = new THREE.Mesh(face, faceMat);
    lit.rotation.x = -Math.PI / 2;
    lit.position.y = 0.052;
    top.add(sl, e, lit);
    g.add(f, p, top);
    group.add(g);
  }

  // --- the star, its halo, the two remnants and the Wound (far beyond the glass; they ignore fog) ---
  const eye = P(b, 0, -4, FLOOR + 1.6);
  const dir = skyDir(0, STAR.el);
  const starMat = own(starMaterial());
  const star = new THREE.Mesh(own(new THREE.SphereGeometry(STAR.radius, 48, 32)), starMat);
  star.position.copy(eye).addScaledVector(dir, STAR.dist);
  star.frustumCulled = false;
  group.add(star);
  // (fix & ship) a tighter, dimmer corona: the old one (×1.6 over 5.2 radii) veiled the whole frame white
  const haloMat = own(new THREE.MeshBasicMaterial({ map: own(glowTexture()), color: new THREE.Color(0.7, 0.86, 1).multiplyScalar(0.55), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(STAR.radius * 3.6, STAR.radius * 3.6)), haloMat);
  halo.position.copy(star.position).addScaledVector(dir, -STAR.radius * 1.2);
  halo.lookAt(eye);
  halo.frustumCulled = false;
  group.add(halo);
  const half = own(new THREE.SphereGeometry(STAR.radius, 40, 28, 0, Math.PI));
  const redMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.8, 1.0).multiplyScalar(3.4), fog: false, side: THREE.DoubleSide }));
  const whiteMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.8, 1.0).multiplyScalar(3.4), fog: false, side: THREE.DoubleSide }));
  // the sphere segment phi 0…π is the +Z half: turned a quarter either way it becomes the west / east half
  const red = new THREE.Mesh(half, redMat);
  red.rotation.y = -Math.PI / 2;
  const white = new THREE.Mesh(half, whiteMat);
  white.rotation.y = Math.PI / 2;
  for (const m of [red, white]) {
    m.position.copy(star.position);
    m.visible = false;
    m.frustumCulled = false;
    group.add(m);
  }
  // (fix & ship) the sky's soft vortex, not a black disc: a quad whose void is the old disc (radius 1 × scale)
  const wound = new THREE.Mesh(own(new THREE.PlaneGeometry(4.4, 4.4)), own(woundMaterial()));
  wound.renderOrder = -5;
  wound.position.copy(eye).addScaledVector(skyDir(0, 12), STAR.dist * 0.92);
  wound.lookAt(eye);
  wound.scale.setScalar(0.001);
  wound.visible = false;
  wound.frustumCulled = false;
  group.add(wound);

  // the memory's sky: a silver haze (palest above the horizon and round the star), one draw call
  const dome = memoryDome(own, dir);
  dome.position.copy(eye);
  group.add(dome);

  // --- the portal: a standing doorway of white-gold light on the bridge, giving straight onto the dark ---
  const portal = new THREE.Group();
  portal.position.copy(P(b, 3.4, 9.2));
  portal.rotation.y = Math.PI * 0.06;
  const pw = 2.6;
  const ph = 4.6;
  const edge = mats.emissive(0xfff1d2, 5);
  const jamb = own(new THREE.BoxGeometry(0.12, ph, 0.12));
  for (const sx of [-1, 1]) {
    const j = new THREE.Mesh(jamb, edge);
    j.position.set((sx * pw) / 2, ph / 2, 0);
    portal.add(j);
  }
  const lintel = new THREE.Mesh(own(new THREE.BoxGeometry(pw + 0.12, 0.12, 0.12)), edge);
  lintel.position.set(0, ph, 0);
  portal.add(lintel);
  const portalInner = new THREE.Mesh(own(new THREE.PlaneGeometry(pw, ph)), own(new THREE.MeshBasicMaterial({ color: 0x010103, fog: false })));
  portalInner.position.set(0, ph / 2, -0.02);
  portal.add(portalInner);
  const sheen = new THREE.Mesh(own(new THREE.PlaneGeometry(pw * 1.9, ph * 1.4)), own(new THREE.MeshBasicMaterial({ map: own(glowTexture()), color: new THREE.Color(1, 0.86, 0.6).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  // the glow sits behind the opening: the dark panel hides its middle, so only the frame's halo shows
  sheen.position.set(0, ph / 2, -0.12);
  portal.add(sheen);
  portal.scale.set(1, 0.001, 1);
  portal.visible = false;
  group.add(portal);

  // --- the King and his chronicler, remembered: two Witness figures lit from within ---
  // The King (the generated `king` body, 1.76 m) as the book has him: “armor broken along one shoulder. Blood runs
  // beneath one eye” — `wounded`; no halo: a real, exhausted man, not an icon. Vesryn (the `vesryn` body, 1.74 m)
  // is plainer and dimmer — his own archetype never has a halo.
  const king: Figure = { visual: null, target: null, speed: 1.0, yaw: 0, look: null };
  const vesryn: Figure = { visual: null, target: null, speed: 1.0, yaw: 0, look: null };
  // the break is on his RIGHT (shoulder plate, blood under the right eye): the Witness's two-shots over the chronicler's
  // shoulder (3–4 m) and its medium shots see him from his right front while he faces his chronicler (polish 4)
  const kv = game.chars.create('kingWitness', { seed: 1, wounded: true, halo: false, woundSide: 'right' });
  const vv = game.chars.create('vesryn', { seed: 2 });
  if (isHumanoidVisual(kv)) king.visual = kv;
  if (isHumanoidVisual(vv)) vesryn.visual = vv;
  kv.setGlow(1.4);
  vv.setGlow(0.3);
  vv.setRim(0.25, 0xd8d0c0);
  for (const v of [kv, vv]) group.add(v.root);
  // the white-gold blade: a line of light in the King's hand
  const blade = new THREE.Mesh(own(new THREE.CylinderGeometry(0.018, 0.012, 1.15, 6)), mats.emissive(0xfff3da, 6));
  blade.position.set(0, 0, -0.62);
  blade.rotation.x = Math.PI / 2;
  blade.visible = false;
  kv.socket('handR').add(blade);

  b.add(b.keep(group));
  return {
    group, star, halo, red, white, wound, portal, portalInner, dome, blade, king, vesryn,
    tgt: { star: 1, sunder: 0, wound: 0, portal: 0, blade: 0 },
    cur: { star: 1, sunder: 0, wound: 0, portal: 0, blade: 0 },
    owned,
  };
}

/** place a figure on the bridge (plan offsets from the dais centre) */
export function placeFigure(b: { P: ZoneBuilder['P'] } | ZoneRuntime, f: Figure, dx: number, dn: number, yawDeg: number): void {
  if (!f.visual) return;
  f.visual.root.position.copy(b.P(C.x + dx, C.n + dn, FLOOR));
  f.yaw = (-yawDeg * Math.PI) / 180;
  f.visual.root.rotation.y = f.yaw;
  f.target = null;
  f.look = null;
  f.visual.teleported();
}

/** send a figure walking to a plan offset (snaps when skipping) */
export function walkFigure(z: ZoneRuntime, f: Figure, dx: number, dn: number, speed = 1.0): void {
  f.target = z.P(C.x + dx, C.n + dn, FLOOR);
  f.speed = speed;
  if (z.skipping && f.visual) {
    f.visual.root.position.copy(f.target);
    f.target = null;
  }
}

const RED = new THREE.Color(1.0, 0.24, 0.08).multiplyScalar(3.0);
const WHITE_HOT = new THREE.Color(1, 0.98, 0.95).multiplyScalar(9);
const BLUE = new THREE.Color(0.62, 0.8, 1.0).multiplyScalar(3.4);
const TMP = new THREE.Vector3();

function ease(cur: number, tgt: number, dt: number, rate: number, snap: boolean): number {
  if (snap) return tgt;
  const d = tgt - cur;
  return Math.abs(d) < 1e-4 ? tgt : cur + Math.sign(d) * Math.min(Math.abs(d), dt * rate);
}

/** ZoneDef.update while the set is live */
export function updateWitnessSet(z: ZoneRuntime, W: WitnessSet, dt: number): void {
  if (!W.group.visible) return;
  const snap = z.skipping;
  W.cur.star = ease(W.cur.star, W.tgt.star, dt, 0.8, snap);
  W.cur.sunder = ease(W.cur.sunder, W.tgt.sunder, dt, 0.16, snap);
  W.cur.wound = ease(W.cur.wound, W.tgt.wound, dt, 0.22, snap);
  W.cur.portal = ease(W.cur.portal, W.tgt.portal, dt, 0.7, snap);
  W.cur.blade = ease(W.cur.blade, W.tgt.blade, dt, 2.5, snap);
  // the whole star, then the sundering: the halves part, shrink and change — red and swollen to the west, small and
  // hard white to the east — while the Wound opens between them
  const s = W.cur.sunder;
  const whole = s <= 0.001;
  W.star.visible = whole && W.cur.star > 0.01;
  W.halo.visible = W.cur.star > 0.01 && s < 0.6;
  (W.halo.material as THREE.MeshBasicMaterial).opacity = (1 - s / 0.6) * W.cur.star;
  W.red.visible = !whole && s < 0.999;
  W.white.visible = !whole && s < 0.999;
  if (!whole) {
    const eye = W.star.position;
    const k = s * s * (3 - 2 * s);
    W.red.position.copy(eye).add(TMP.set(-1, 0.12, 0).multiplyScalar(k * 900));
    W.white.position.copy(eye).add(TMP.set(1, 0.06, 0).multiplyScalar(k * 860));
    W.red.scale.setScalar(1 - 0.35 * k);
    W.white.scale.setScalar(Math.max(0.04, 1 - 0.95 * k));
    (W.red.material as THREE.MeshBasicMaterial).color.copy(BLUE).lerp(RED, Math.min(1, k * 1.4));
    (W.white.material as THREE.MeshBasicMaterial).color.copy(BLUE).lerp(WHITE_HOT, Math.min(1, k * 1.6));
    const fade = s > 0.75 ? 1 - (s - 0.75) / 0.25 : 1;
    W.red.scale.multiplyScalar(Math.max(0.02, fade));
    W.white.scale.multiplyScalar(Math.max(0.02, fade));
  }
  const du = (W.dome.material as THREE.ShaderMaterial).uniforms;
  du.uStar.value = W.cur.star * (1 - s);
  du.uSunder.value = s;
  du.uTime.value += dt;
  (W.star.material as THREE.ShaderMaterial).uniforms.uTime.value = du.uTime.value;
  W.wound.visible = W.cur.wound > 0.005;
  W.wound.scale.setScalar(Math.max(0.001, W.cur.wound * 300));
  const wu = (W.wound.material as THREE.ShaderMaterial).uniforms;
  wu.uTime.value = du.uTime.value;
  wu.uOpen.value = Math.min(1, W.cur.wound * 1.6);
  W.portal.visible = W.cur.portal > 0.005;
  W.portal.scale.set(1, Math.max(0.001, W.cur.portal), 1);
  W.blade.visible = W.cur.blade > 0.02;
  W.blade.scale.set(1, Math.max(0.05, W.cur.blade), 1);
  for (const f of [W.king, W.vesryn]) {
    const v = f.visual;
    if (!v) continue;
    let speed = 0;
    if (f.target) {
      const p = v.root.position;
      TMP.copy(f.target).sub(p);
      TMP.y = 0;
      const d = TMP.length();
      if (snap || d < 0.05) {
        p.copy(f.target);
        f.target = null;
      } else {
        const step = Math.min(d, f.speed * dt);
        p.addScaledVector(TMP.normalize(), step);
        f.yaw = Math.atan2(-TMP.x, -TMP.z);
        speed = f.speed;
      }
    }
    if (!f.target && f.look?.visual) {
      const o = f.look.visual.root.position;
      const p = v.root.position;
      if (Math.hypot(o.x - p.x, o.z - p.z) > 0.2) f.yaw = Math.atan2(-(o.x - p.x), -(o.z - p.z));
    }
    let dy = f.yaw - v.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    v.root.rotation.y += snap ? dy : dy * Math.min(1, dt * 6);
    v.setLocomotion(speed, 0);
    v.update(dt);
  }
}

export function disposeWitnessSet(W: WitnessSet): void {
  W.blade.removeFromParent();
  for (const f of [W.king, W.vesryn]) {
    if (!f.visual) continue;
    f.visual.root.removeFromParent();
    f.visual.dispose();
  }
  for (const o of W.owned) o.dispose();
}
