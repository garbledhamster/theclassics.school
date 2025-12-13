export function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let bin = "";
  arr.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

export function base64ToBytes(str) {
  if (!str) return new Uint8Array();
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function clearTrustedDeviceCache() {
  try {
    localStorage.removeItem("trustedVaultKeyRaw");
    localStorage.removeItem("trustedVaultSalt");
  } catch (err) {
    console.error("Error clearing trusted cache", err);
  }
}

export async function persistTrustedCache(keyToStore, vaultSaltBytes) {
  try {
    const raw = await crypto.subtle.exportKey("raw", keyToStore);
    const rawBytes = new Uint8Array(raw);
    localStorage.setItem("trustedVaultKeyRaw", bytesToBase64(rawBytes));
    if (vaultSaltBytes) {
      localStorage.setItem("trustedVaultSalt", bytesToBase64(vaultSaltBytes));
    }
  } catch (err) {
    console.error("Trusted key persist failed", err);
  }
}

export async function getTrustedCache() {
  try {
    const rawBase64 = localStorage.getItem("trustedVaultKeyRaw");
    if (!rawBase64) return null;
    const saltBase64 = localStorage.getItem("trustedVaultSalt");
    const keyBytes = base64ToBytes(rawBase64);
    const saltBytes = saltBase64 ? base64ToBytes(saltBase64) : null;
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", true, ["encrypt", "decrypt"]);
    return { key, vaultSaltBytes: saltBytes };
  } catch (err) {
    console.error("Error reading trusted cache", err);
    return null;
  }
}
