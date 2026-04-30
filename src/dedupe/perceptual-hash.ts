import sharp from 'sharp';
// @ts-expect-error — no type declarations for sharp-phash
import phash from 'sharp-phash';

/**
 * Compute a 64-bit perceptual dHash of a PNG buffer.
 * Returns a hex string.
 */
export async function computeHash(imageBuffer: Buffer): Promise<string> {
  const hash: string = await phash(imageBuffer);
  return hash;
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
