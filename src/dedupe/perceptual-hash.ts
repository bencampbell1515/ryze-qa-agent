import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
type PhashFn = (image: Buffer) => Promise<string>;
const phash = _require('sharp-phash') as PhashFn;

/**
 * Compute a 64-bit perceptual dHash of a PNG buffer.
 * Returns a hex string.
 */
export async function computeHash(imageBuffer: Buffer): Promise<string> {
  return phash(imageBuffer);
}

/**
 * Compute Hamming distance between two hex hash strings.
 * Lower = more similar. 0 = identical. ≤4 = same bug.
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    distance += xor.toString(2).split('1').length - 1;
  }
  return distance;
}
