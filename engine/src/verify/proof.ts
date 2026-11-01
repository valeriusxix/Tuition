// §11 verification. Builds web/public/data/proof.json (completed on Day 9).

/**
 * Where the delegate public key appears in the account object's JSON (§11.2), or null.
 * Case-insensitive for hex; also tries base64 (how Sui GraphQL renders vector<u8>) and the
 * decimal byte-array form.
 */
export function findDelegateKey(objectJson: string, publicKey: Uint8Array): string | null {
  const haystack = objectJson.toLowerCase();
  const hex = Buffer.from(publicKey).toString("hex");
  if (haystack.includes(`0x${hex}`)) return "hex with 0x";
  if (haystack.includes(hex)) return "hex without 0x";
  if (objectJson.includes(Buffer.from(publicKey).toString("base64"))) return "base64";
  if (haystack.replace(/\s+/g, "").includes(`[${Array.from(publicKey).join(",")}]`)) return "decimal byte array";
  return null;
}
