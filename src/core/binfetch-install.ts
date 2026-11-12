/**
 * (ship) Imported first by `src/main.ts` so the binary shim is in place before any module starts a fetch.
 * Only a build made for the text-only page host (`VITE_HOST_B64=1`, set by `npm run build:ship`) installs it.
 */
import { installBinaryShim } from './binfetch';

if (import.meta.env.VITE_HOST_B64 === '1' && typeof window !== 'undefined') installBinaryShim();
