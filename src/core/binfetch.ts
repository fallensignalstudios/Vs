/**
 * (ship) Binary files on a text-only host.
 *
 * The claude.ai page host serves only standard web types (scripts, data, images, fonts, media). It does not serve
 * `.glb` models or the `.bin` LOD and voice packs. `tools/pack-b64.mjs` therefore rewrites every such file in the
 * shipped `dist/` as base64 text next to it (`models/king.glb` → `models/king.glb.txt`) and removes the original.
 *
 * In a build made for that host (`VITE_HOST_B64=1`, set by `npm run build:ship`) this shim wraps `fetch`: a
 * same-origin request for a `.glb` or `.bin` URL fetches the `.txt` sibling instead, decodes it and answers with
 * the original bytes, so every loader (GLTFLoader through three's FileLoader, the LOD loader, the voice packs)
 * works unchanged. Dev, tests and plain builds never install it.
 */

const BINARY = /\.(?:glb|bin)$/i;

/** The `.txt` sibling to fetch for a binary URL, or null when the URL is not a same-origin binary. */
export function binaryTextUrl(url: string, base: string): string | null {
  let u: URL;
  let b: URL;
  try {
    b = new URL(base);
    u = new URL(url, b);
  } catch {
    return null;
  }
  if (u.origin !== b.origin || !BINARY.test(u.pathname)) return null;
  u.pathname = `${u.pathname}.txt`;
  return u.href;
}

/** Decode base64 text (whitespace tolerated) to bytes. */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof native === 'function') return native(clean);
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type FetchFn = typeof fetch;

/** Wrap a fetch so same-origin `.glb` / `.bin` requests are served from their base64 `.txt` siblings. */
export function wrapFetch(inner: FetchFn, base: () => string): FetchFn {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = binaryTextUrl(url, base());
    if (!target) return inner(input, init);
    const signal = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined);
    const res = await inner(target, signal ? { signal } : undefined);
    if (!res.ok) return res;
    const bytes = decodeBase64(await res.text());
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(bytes.byteLength) },
    });
  };
  return wrapped as FetchFn;
}

let installed = false;

/** Install the shim on `window.fetch` (once). Only call it in a build made for the text-only host. */
export function installBinaryShim(win: Window & typeof globalThis = window): void {
  if (installed) return;
  installed = true;
  const inner = win.fetch.bind(win);
  win.fetch = wrapFetch(inner, () => win.document.baseURI);
}
