import { describe, expect, it } from 'vitest';
import { binaryTextUrl, decodeBase64, wrapFetch } from './binfetch';

const BASE = 'https://host.example/a/b/game/';
const toB64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

describe('binfetch (text-only host shim)', () => {
  it('maps same-origin .glb and .bin URLs to their .txt siblings', () => {
    expect(binaryTextUrl('./models/king.glb', BASE)).toBe('https://host.example/a/b/game/models/king.glb.txt');
    expect(binaryTextUrl('models/king.lod.bin', BASE)).toBe('https://host.example/a/b/game/models/king.lod.bin.txt');
    expect(binaryTextUrl('audio/vo/packs/Z11.bin?v=2', BASE)).toBe('https://host.example/a/b/game/audio/vo/packs/Z11.bin.txt?v=2');
    expect(binaryTextUrl('https://host.example/a/b/game/models/varo.GLB', BASE)).toBe('https://host.example/a/b/game/models/varo.GLB.txt');
  });

  it('leaves everything else alone', () => {
    expect(binaryTextUrl('textures/marble_slab_albedo.webp', BASE)).toBeNull();
    expect(binaryTextUrl('audio/vo/packs/index.json', BASE)).toBeNull();
    expect(binaryTextUrl('audio/music/main_theme.mp3', BASE)).toBeNull();
    expect(binaryTextUrl('https://other.example/x.glb', BASE)).toBeNull();
    expect(binaryTextUrl('data:application/octet-stream;base64,AAAA', BASE)).toBeNull();
    expect(binaryTextUrl('blob:https://host.example/123', BASE)).toBeNull();
  });

  it('decodes base64 with whitespace', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 103, 108, 84, 70]);
    const b64 = toB64(bytes);
    expect(Array.from(decodeBase64(`${b64.slice(0, 4)}\n${b64.slice(4)}\n`))).toEqual(Array.from(bytes));
  });

  it('serves binaries from the .txt sibling and passes other requests through', async () => {
    const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 255]);
    const seen: string[] = [];
    const inner = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      if (url.endsWith('king.glb.txt')) return new Response(toB64(bytes));
      if (url.endsWith('missing.bin.txt')) return new Response('nope', { status: 404 });
      return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const f = wrapFetch(inner, () => BASE);

    const glb = await f(new Request(`${BASE}models/king.glb`));
    expect(glb.status).toBe(200);
    expect(Array.from(new Uint8Array(await glb.arrayBuffer()))).toEqual(Array.from(bytes));

    const missing = await f('audio/vo/packs/missing.bin');
    expect(missing.status).toBe(404);

    const json = await f(`${BASE}models/manifest.json`);
    expect(await json.json()).toEqual({ ok: true });

    expect(seen).toEqual([
      `${BASE}models/king.glb.txt`,
      `${BASE}audio/vo/packs/missing.bin.txt`,
      `${BASE}models/manifest.json`,
    ]);
  });
});
