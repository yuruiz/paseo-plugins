import { base64 } from "@scure/base";
import { MAX_FILE_BYTES, type SecretFile } from "./contracts.js";

export function validSecretFile(file: Pick<SecretFile, "data" | "format">) {
  let bytes: Uint8Array | undefined;
  try {
    bytes = base64.decode(file.data);
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || base64.encode(bytes) !== file.data)
      return false;
    if (file.format === "any") return true;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (file.format === "json") {
      JSON.parse(text);
      return true;
    }
    return /^-----BEGIN ([A-Z0-9 ]+)-----\r?\n[\s\S]+\r?\n-----END \1-----\s*$/.test(text);
  } catch {
    return false;
  } finally {
    bytes?.fill(0);
  }
}

export function pastedSecretFile(
  value: string,
  format: SecretFile["format"],
): Omit<SecretFile, "name"> | null {
  if (!value || value.length > MAX_FILE_BYTES) return null;
  const bytes = new TextEncoder().encode(value);
  try {
    if (bytes.length > MAX_FILE_BYTES) return null;
    return { format, data: base64.encode(bytes) };
  } finally {
    bytes.fill(0);
  }
}
