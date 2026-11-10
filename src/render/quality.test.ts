import { describe, expect, it } from 'vitest';
import { AutoQualityGovernor, classifyGpu, DynamicResolution, isQualityLevel, lowerQuality, QUALITY_PRESETS } from './quality';

describe('quality presets', () => {
  it('scale monotonically', () => {
    const { low, medium, high, ultra } = QUALITY_PRESETS;
    expect(low.ao).toBe(false);
    expect(low.reflections).toBe(false);
    expect(medium.reflections).toBe(false);
    expect(high.reflections).toBe(true);
    expect(low.shadowMapSize).toBeLessThanOrEqual(medium.shadowMapSize);
    expect(high.shadowMapSize).toBeLessThanOrEqual(ultra.shadowMapSize);
    expect(low.particleScale).toBeLessThan(high.particleScale);
    expect(high.maxShadowLights).toBeLessThanOrEqual(2);
    for (const q of [low, medium, high, ultra]) expect(q.resolutionScale).toBeLessThanOrEqual(1);
  });

  it('helpers', () => {
    expect(isQualityLevel('high')).toBe(true);
    expect(isQualityLevel('auto')).toBe(false);
    expect(lowerQuality('ultra')).toBe('high');
    expect(lowerQuality('low')).toBe('low');
  });
});

describe('classifyGpu', () => {
  const cases: Array<[string, string]> = [
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'low'],
    ['llvmpipe (LLVM 15.0.7, 256 bits)', 'low'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'low'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 750 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'medium'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'high'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)', 'ultra'],
    ['Adreno (TM) 650', 'low'],
    ['Adreno (TM) 740', 'medium'],
    ['Mali-G78', 'low'],
    ['Some Unknown Renderer 9000', 'medium'],
  ];
  for (const [s, level] of cases) {
    it(`${s.slice(0, 60)} → ${level}`, () => expect(classifyGpu(s)).toBe(level));
  }

  it('handles missing strings', () => {
    expect(classifyGpu(null)).toBe('medium');
    expect(classifyGpu('', { mobile: true })).toBe('low');
    expect(classifyGpu('Apple GPU', { mobile: true })).toBe('medium');
    expect(classifyGpu('Apple GPU')).toBe('high');
  });
});

/** Drive a controller for `seconds` against a frame-time model (ms as a function of the resolution scale). */
function run(dr: DynamicResolution, seconds: number, model: (scale: number) => number): number {
  let t = 0;
  let changes = 0;
  while (t < seconds) {
    const ms = model(dr.scale);
    if (dr.update(ms)) changes++;
    t += ms / 1000;
  }
  return changes;
}

describe('DynamicResolution', () => {
  it('starts at full scale and stays there when the budget holds', () => {
    const dr = new DynamicResolution();
    expect(run(dr, 30, () => 16.7)).toBe(0);
    expect(dr.scale).toBe(1);
  });

  it('drops quickly under sustained load and respects the floor', () => {
    const dr = new DynamicResolution();
    run(dr, 2, () => 26);
    expect(dr.scale).toBeLessThan(1);
    run(dr, 20, () => 40);
    expect(dr.scale).toBeCloseTo(0.6, 5);
    expect(dr.atFloor).toBe(true);
  });

  it('settles without oscillating when cost follows pixel count under vsync', () => {
    const dr = new DynamicResolution();
    // 21 ms at full resolution, cost ∝ scale², vsync floor 16.7 ms → budget met at scale ≤ ~0.9
    const model = (s: number) => Math.max(16.7, 21 * s * s);
    run(dr, 20, model);
    expect(dr.scale).toBeLessThanOrEqual(0.9);
    expect(dr.scale).toBeGreaterThanOrEqual(0.8);
    // a further two minutes: the occasional upward probe backs off instead of flapping
    const changes = run(dr, 120, model);
    expect(changes).toBeLessThanOrEqual(10);
    expect(model(dr.scale)).toBeLessThan(18.6);
  });

  it('climbs back when load disappears', () => {
    const dr = new DynamicResolution();
    run(dr, 10, () => 40);
    expect(dr.scale).toBeCloseTo(0.6, 5);
    run(dr, 90, () => 8); // high-refresh display with headroom
    expect(dr.scale).toBe(1);
  });

  it('ignores hitches and nonsense', () => {
    const dr = new DynamicResolution();
    for (let i = 0; i < 50; i++) dr.update(400);
    dr.update(Number.NaN);
    dr.update(-5);
    expect(dr.scale).toBe(1);
    expect(dr.ema).toBe(0);
  });

  it('quantises to its step', () => {
    const dr = new DynamicResolution({ step: 0.05 });
    run(dr, 5, () => 23);
    expect(Math.abs(dr.scale * 20 - Math.round(dr.scale * 20))).toBeLessThan(1e-6);
  });
});

describe('AutoQualityGovernor', () => {
  it('steps down early when the first second of play is clearly too slow', () => {
    const g = new AutoQualityGovernor();
    let stepped = 0;
    for (let i = 0; i < 100; i++) if (g.update(45, false)) stepped++;
    expect(stepped).toBe(1);
  });

  it('leaves a healthy frame rate alone', () => {
    const g = new AutoQualityGovernor();
    let stepped = 0;
    for (let i = 0; i < 4000; i++) if (g.update(16.7, true)) stepped++;
    expect(stepped).toBe(0);
  });

  it('steps down later only when dynamic resolution has bottomed out, at most twice', () => {
    const g = new AutoQualityGovernor(2);
    for (let i = 0; i < 100; i++) g.update(17, false);
    let stepped = 0;
    for (let i = 0; i < 600; i++) if (g.update(26, false)) stepped++;
    expect(stepped).toBe(0); // dynamic resolution still has room
    for (let i = 0; i < 6000; i++) if (g.update(26, true)) stepped++;
    expect(stepped).toBe(2);
  });
});
