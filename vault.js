const encoder = new TextEncoder()
const decoder = new TextDecoder()

function bufferToBase64(buffer){
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ""
  bytes.forEach(b => binary += String.fromCharCode(b))
  return btoa(binary)
}

function base64ToBytes(str){
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for(let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function generatePassphrase(){
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%^&*"
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const chars = Array.from(bytes, b => alphabet[b % alphabet.length])
  const grouped = []
  for(let i=0;i<chars.length;i+=6){
    grouped.push(chars.slice(i,i+6).join(""))
  }
  return grouped.join("-")
}

export async function deriveKeyFromPassphrase(passphrase, saltBytes){
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  )
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.deriveKey(
    {name:"PBKDF2", salt, iterations:210000, hash:"SHA-256"},
    keyMaterial,
    {name:"AES-GCM", length:256},
    false,
    ["encrypt","decrypt"]
  )
  return { key, salt }
}

export async function encryptSecret(plainText, key, saltBytes){
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {name:"AES-GCM", iv},
    key,
    encoder.encode(plainText || "")
  )
  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    iv: bufferToBase64(iv),
    salt: bufferToBase64(saltBytes),
    version: 1
  }
}

export async function decryptSecret(payload, key){
  const iv = base64ToBytes(payload.iv)
  const ciphertext = base64ToBytes(payload.ciphertext)
  const plainBuffer = await crypto.subtle.decrypt(
    {name:"AES-GCM", iv},
    key,
    ciphertext
  )
  return decoder.decode(plainBuffer)
}

export function decodeSalt(base64Salt){
  return base64ToBytes(base64Salt)
}
