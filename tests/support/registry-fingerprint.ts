import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
        .map((key) => [
          key,
          canonicalize((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

/** SHA-256 of a registry entry's full content with code-point-ordered keys. */
export function registryEntryFingerprint(entry: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(entry)))
    .digest("hex");
}
