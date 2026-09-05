import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

export const shortId = customAlphabet(alphabet, 12);
export const tokenId = customAlphabet(alphabet + "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 32);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}
