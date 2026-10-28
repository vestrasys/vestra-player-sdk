/**
 * The manifest rules `vestra-plugin check` applies; the same table as the
 * player's `src/host/src/packages/manifest.rs` (the player's tests compare the limits).
 * Paths in the manifest are checked against the plugin directory.
 */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { API_VERSION, CAPABILITIES } from "./capabilities.ts";

export const MANIFEST_LIMITS = Object.freeze({
  idBytes: 128,
  name: 64,
  author: 64,
  punchline: 120,
  description: 2000,
  tags: 8,
  tag: 24,
  license: 64,
  urlBytes: 2048,
  iconBytes: 512 * 1024,
  iconSide: 1024,
  documentBytes: 256 * 1024,
});

/** Every field a manifest may have; anything else is rejected by the player. */
export const MANIFEST_FIELDS: readonly string[] = [
  "id",
  "version",
  "apiVersion",
  "entry",
  "capabilities",
  "name",
  "author",
  "punchline",
  "description",
  "tags",
  "icon",
  "readme",
  "changelog",
  "sourceUrl",
  "license",
  "minPlayerVersion",
];

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const validVersion = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 32 &&
  VERSION.test(value) &&
  value.split(".").every((part) => BigInt(part) <= 4294967295n);

/** Problems with `manifest` (empty: valid) and hints that do not fail. */
export function manifestProblems(
  manifest: Record<string, unknown>,
  directory: string,
): { problems: string[]; hints: string[] } {
  const problems: string[] = [];
  const hints: string[] = [];
  const problem = (text: string) => problems.push(text);
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  )
    return { problems: ["manifest.json must be an object"], hints };
  for (const key of Object.keys(manifest))
    if (!MANIFEST_FIELDS.includes(key)) problem(`unknown field "${key}"`);
  const id = manifest.id;
  if (
    typeof id !== "string" ||
    !id ||
    Buffer.byteLength(id) > MANIFEST_LIMITS.idBytes ||
    !/^[A-Za-z0-9._-]+$/.test(id)
  )
    problem("id must be 1–128 ASCII letters, digits, '.', '-' or '_'");
  else if (!id.includes("."))
    hints.push(
      `id "${id}" has no prefix: the official repository needs <GitHub user or organization>.<plugin name>`,
    );
  if (manifest.apiVersion !== API_VERSION)
    problem(
      `apiVersion is ${JSON.stringify(manifest.apiVersion)}; this SDK is ${API_VERSION}`,
    );
  const capabilities = manifest.capabilities;
  if (!Array.isArray(capabilities)) problem("capabilities must be an array");
  else {
    const unknown = capabilities.filter((c) => !CAPABILITIES.includes(c));
    if (unknown.length) problem(`unknown capabilities ${unknown.join(", ")}`);
    if (new Set(capabilities).size !== capabilities.length)
      problem("capabilities must be unique");
  }
  if (typeof manifest.entry !== "string" || !relative(manifest.entry))
    problem("entry must be a relative path inside the package");
  if (manifest.version !== undefined && !validVersion(manifest.version))
    problem("version must be MAJOR.MINOR.PATCH without leading zeros");
  if (
    manifest.minPlayerVersion !== undefined &&
    !validVersion(manifest.minPlayerVersion)
  )
    problem("minPlayerVersion must be MAJOR.MINOR.PATCH without leading zeros");
  const text = (field: string, max: number, multiline = false) => {
    const value = manifest[field];
    if (value === undefined) return;
    if (typeof value !== "string") return problem(`${field} must be a string`);
    const count = [...value].length;
    if (count < 1 || count > max)
      return problem(`${field} must have 1–${max} characters`);
    if (value.trim() !== value)
      return problem(`${field} must not start or end with whitespace`);
    const control = multiline
      ? /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/
      : /[\u0000-\u001f\u007f-\u009f]/;
    if (control.test(value))
      problem(`${field} must not contain control characters`);
  };
  text("name", MANIFEST_LIMITS.name);
  text("author", MANIFEST_LIMITS.author);
  text("punchline", MANIFEST_LIMITS.punchline);
  text("description", MANIFEST_LIMITS.description, true);
  text("license", MANIFEST_LIMITS.license);
  if (manifest.tags !== undefined) {
    const tags = manifest.tags;
    if (!Array.isArray(tags)) problem("tags must be an array");
    else {
      if (tags.length > MANIFEST_LIMITS.tags)
        problem(`at most ${MANIFEST_LIMITS.tags} tags`);
      const seen = new Set<string>();
      for (const tag of tags) {
        if (
          typeof tag !== "string" ||
          [...tag].length < 1 ||
          [...tag].length > MANIFEST_LIMITS.tag ||
          tag.trim() !== tag ||
          /[\u0000-\u001f\u007f-\u009f]/.test(tag)
        )
          problem(
            `each tag must be 1–${MANIFEST_LIMITS.tag} characters on one line`,
          );
        else if (seen.has(tag.toLowerCase())) problem(`duplicate tag ${tag}`);
        else seen.add(tag.toLowerCase());
      }
    }
  }
  if (manifest.sourceUrl !== undefined) {
    const url = manifest.sourceUrl;
    let ok = false;
    try {
      ok =
        typeof url === "string" &&
        Buffer.byteLength(url) <= MANIFEST_LIMITS.urlBytes &&
        new URL(url).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!ok)
      problem("sourceUrl must be an https: address of at most 2048 bytes");
  }
  const file = (field: string, max: number, extensions: string[]) => {
    const value = manifest[field];
    if (value === undefined) return null;
    if (typeof value !== "string" || !relative(value))
      return void problem(
        `${field} must be a relative path inside the package`,
      );
    if (!extensions.some((x) => value.toLowerCase().endsWith(x)))
      return void problem(`${field} must be a ${extensions.join(" or ")} file`);
    const path = join(directory, value);
    if (!existsSync(path))
      return void problem(`${field} file ${value} is missing`);
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      return void problem(`${field} file ${value} is unreadable`);
    }
    const root = realpathSync(directory);
    if (!real.startsWith(root + sep) || lstatSync(real).isDirectory())
      return void problem(`${field} must name a file inside the package`);
    const bytes = readFileSync(real);
    if (bytes.length > max)
      return void problem(`${field} file exceeds ${max / 1024} KB`);
    return bytes;
  };
  const icon = file("icon", MANIFEST_LIMITS.iconBytes, [
    ".png",
    ".jpg",
    ".jpeg",
  ]);
  if (icon) {
    const size = imageSize(icon);
    if (!size) problem("icon must be a PNG or JPEG image");
    else if (
      size.width > MANIFEST_LIMITS.iconSide ||
      size.height > MANIFEST_LIMITS.iconSide
    )
      problem(`icon sides must be at most ${MANIFEST_LIMITS.iconSide} pixels`);
  }
  for (const field of ["readme", "changelog"]) {
    const bytes = file(field, MANIFEST_LIMITS.documentBytes, [".md"]);
    if (bytes) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        problem(`${field} must be UTF-8`);
      }
    }
  }
  return { problems, hints };
}

/** A package-relative path: `/`-separated normal components only. */
function relative(path: string) {
  return (
    path.length > 0 &&
    Buffer.byteLength(path) <= 1024 &&
    !/[\u0000-\u001f\u007f\\]/.test(path) &&
    !path.startsWith("/") &&
    !/^[A-Za-z]:/.test(path) &&
    path.split("/").length <= 12 &&
    path.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

/** Width and height of a PNG or JPEG, or null for anything else. */
export function imageSize(bytes: Uint8Array) {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.length >= 24 &&
    view
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
  if (view.length >= 4 && view[0] === 0xff && view[1] === 0xd8) {
    let at = 2;
    while (at + 9 < view.length) {
      if (view[at] !== 0xff) return null;
      const marker = view[at + 1]!;
      const length = view.readUInt16BE(at + 2);
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      )
        return {
          height: view.readUInt16BE(at + 5),
          width: view.readUInt16BE(at + 7),
        };
      at += 2 + length;
    }
  }
  return null;
}
