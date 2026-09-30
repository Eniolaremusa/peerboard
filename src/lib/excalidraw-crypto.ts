const IV_LENGTH = 12;

function toBuffer(data: Uint8Array | ArrayBuffer | string) {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  return new Uint8Array(data instanceof Uint8Array ? data : data);
}

export function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (
    value &&
    typeof value === "object" &&
    "data" in value &&
    Array.isArray((value as { data: unknown }).data)
  ) {
    return Uint8Array.from((value as { data: number[] }).data);
  }
  throw new Error("Could not read encrypted payload");
}

async function cryptoKey(key: string, usage: KeyUsage) {
  return crypto.subtle.importKey(
    "jwk",
    {
      alg: "A128GCM",
      ext: true,
      k: key,
      key_ops: ["encrypt", "decrypt"],
      kty: "oct",
    },
    { name: "AES-GCM", length: 128 },
    false,
    [usage],
  );
}

export async function encryptBytes(key: string, data: Uint8Array | string) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await cryptoKey(key, "encrypt"),
    toBuffer(data),
  );
  return { encryptedBuffer, iv };
}

export async function decryptBytes(
  key: string,
  iv: Uint8Array,
  encrypted: Uint8Array | ArrayBuffer,
) {
  const ivBytes = new Uint8Array(iv.byteLength);
  ivBytes.set(iv);
  const payload = new Uint8Array(
    encrypted instanceof ArrayBuffer ? encrypted.byteLength : encrypted.byteLength,
  );
  payload.set(
    encrypted instanceof Uint8Array ? encrypted : new Uint8Array(encrypted),
  );
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes },
    await cryptoKey(key, "decrypt"),
    payload,
  );
}

export function collabServerUrl() {
  return process.env.NEXT_PUBLIC_EXCALIDRAW_ROOM_URL?.replace(/\/$/, "") ?? "";
}
