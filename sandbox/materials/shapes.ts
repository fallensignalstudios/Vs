/** Test geometry for the materials sandbox. None of it has UVs worth using — that is the point. */
import * as THREE from 'three';

/** Upright slab with 45° chamfers on every edge (tests triplanar blending across bevels). */
export function bevelledSlab(w = 0.9, h = 1.3, d = 0.22, bevel = 0.06): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x = w / 2 - bevel, y = h / 2 - bevel;
  s.moveTo(-x, -y); s.lineTo(x, -y); s.lineTo(x, y); s.lineTo(-x, y); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 });
  g.translate(0, h / 2, -(d - bevel * 2) / 2);
  g.deleteAttribute('uv');
  return g;
}

/** A curved rib segment: rounded-rectangle section swept along a quarter arc. */
export function ribSegment(radius = 1.5, width = 0.3, depth = 0.42): THREE.BufferGeometry {
  const sec = new THREE.Shape();
  const hw = width / 2, hd = depth / 2, r = 0.05;
  sec.moveTo(-hw + r, -hd); sec.lineTo(hw - r, -hd); sec.quadraticCurveTo(hw, -hd, hw, -hd + r);
  sec.lineTo(hw, hd - r); sec.quadraticCurveTo(hw, hd, hw - r, hd);
  sec.lineTo(-hw + r, hd); sec.quadraticCurveTo(-hw, hd, -hw, hd - r);
  sec.lineTo(-hw, -hd + r); sec.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 0.5;
    pts.push(new THREE.Vector3(radius - Math.cos(a) * radius, Math.sin(a) * radius, 0));
  }
  const g = new THREE.ExtrudeGeometry(sec, { steps: 40, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(pts) });
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Plain box without UVs. */
export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  return g;
}

/** Floor-facing text label. */
export function label(text: string, width = 1.5): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(8,10,14,0.82)';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#e9dcc0';
    ctx.font = '600 44px "Barlow Condensed", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 50);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, (width * 96) / 512), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.rotation.x = -Math.PI / 2;
  return m;
}
