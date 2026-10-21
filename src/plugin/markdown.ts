/**
 * `plugin.ui.markdown`: the player parses and draws the document; this side
 * downloads its `https:` images into the plugin's data directory first
 * (Node's `fetch`, so the player needs no HTTP stack). The cache is
 * `<dataDirectory>/.vestra-cache/markdown/`, one file per address.
 */
import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Json } from "../wire.ts";
import { failure } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { MarkdownOptions, MarkdownRef } from "./types.ts";

export const MARKDOWN_LIMITS = Object.freeze({
  /** Text bytes (UTF-8). */
  textBytes: 256 * 1024,
  /** Bytes of one downloaded image. */
  imageBytes: 4 * 1024 * 1024,
  /** Download time per image. */
  imageTimeoutMs: 10_000,
  /** Redirects followed per image. */
  redirects: 5,
  /** Downloads at once, per plugin. */
  concurrency: 4,
  /** Cache size per plugin. */
  cacheBytes: 32 * 1024 * 1024,
  /** An address is fetched again after this long. */
  cacheMaxAgeMs: 24 * 60 * 60 * 1000,
});

let documents = 0;

/** The wire form (`{ $vestraMarkdown: { text, base, images }, ref }`) is internal. */
export class MarkdownHandle implements MarkdownRef {
  readonly text: string;
  readonly __vestraMarkdown = true as const;
  readonly #scope: ScopeImpl;
  readonly #base: string | null;
  readonly #images: Record<string, string>;
  readonly #ref = ++documents;
  constructor(
    scope: ScopeImpl,
    text: string,
    base: string | null,
    images: Record<string, string>,
  ) {
    this.#scope = scope;
    this.text = text;
    this.#base = base;
    this.#images = images;
  }
  /** Released with its scope: writing it is `invalid`. */
  get released() {
    return this.#scope.disposed;
  }
  toJSON(): Json {
    return {
      $vestraMarkdown: {
        text: this.text,
        base: this.#base,
        images: { ...this.#images },
      },
      ref: this.#ref,
    };
  }
}

const isPng = (b: Uint8Array) =>
  b.length > 8 &&
  b[0] === 0x89 &&
  b[1] === 0x50 &&
  b[2] === 0x4e &&
  b[3] === 0x47;
const isJpeg = (b: Uint8Array) =>
  b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** `https:` only, redirects followed by hand (≤ 5, all `https:`), size capped while reading. */
async function httpsDownload(
  url: string,
  options: { maxBytes: number; signal: AbortSignal },
): Promise<Uint8Array> {
  let address = url;
  for (let hop = 0; hop <= MARKDOWN_LIMITS.redirects; hop++) {
    if (!address.startsWith("https://"))
      throw new Error("only https: images are downloaded");
    const response = await fetch(address, {
      redirect: "manual",
      signal: options.signal,
      credentials: "omit",
      headers: {
        "user-agent":
          "VestraPlayer-Markdown/1.1 (+https://github.com/vestrasys/vestra-player-sdk)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error(`redirect without location`);
      address = new URL(location, address).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    const length = Number(response.headers.get("content-length"));
    if (length > options.maxBytes) {
      await response.body?.cancel();
      throw new Error("image too large");
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > options.maxBytes) throw new Error("image too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new Error("too many redirects");
}

/** Download (or reuse) the images; address → local file for each success. */
async function fetchImages(
  runtime: Runtime,
  urls: string[],
): Promise<Record<string, string>> {
  const data = runtime.dataDirectory;
  if (!data || !urls.length) return {};
  const cache = join(data, ".vestra-cache", "markdown");
  await mkdir(cache, { recursive: true });
  const download = runtime.local?.download ?? httpsDownload;
  const found: Record<string, string> = {};
  const queue = [...new Set(urls)].filter((u) => u.startsWith("https://"));
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const file = join(cache, createHash("sha256").update(url).digest("hex"));
      try {
        const info = await stat(file).catch(() => null);
        const now = Date.now();
        if (info && now - info.mtimeMs < MARKDOWN_LIMITS.cacheMaxAgeMs) {
          const time = new Date(info.mtimeMs);
          await utimes(file, new Date(now), time).catch(() => {});
          found[url] = file;
          continue;
        }
        const bytes = await download(url, {
          maxBytes: MARKDOWN_LIMITS.imageBytes,
          signal: AbortSignal.timeout(MARKDOWN_LIMITS.imageTimeoutMs),
        });
        if (bytes.length > MARKDOWN_LIMITS.imageBytes)
          throw new Error("image too large");
        if (!isPng(bytes) && !isJpeg(bytes))
          throw new Error("not a PNG or JPEG image");
        const temporary = `${file}.${process.pid}.tmp`;
        await writeFile(temporary, bytes);
        await rename(temporary, file);
        found[url] = file;
      } catch {
        // Shown as its alt text.
      }
    }
  };
  await Promise.all(
    Array.from({ length: MARKDOWN_LIMITS.concurrency }, worker),
  );
  await trim(cache, new Set(Object.values(found)));
  return found;
}

/** Keep the cache under its size: drop the least recently used files not in use. */
async function trim(cache: string, keep: Set<string>) {
  const files = [];
  for (const name of await readdir(cache).catch(() => [] as string[])) {
    const path = join(cache, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile())
      files.push({ path, size: info.size, used: info.atimeMs });
  }
  let total = files.reduce((sum, f) => sum + f.size, 0);
  files.sort((a, b) => a.used - b.used);
  for (const file of files) {
    if (total <= MARKDOWN_LIMITS.cacheBytes) break;
    if (keep.has(file.path)) continue;
    await unlink(file.path).catch(() => {});
    total -= file.size;
  }
}

export async function markdown(
  scope: ScopeImpl,
  text: string,
  options: MarkdownOptions = {},
): Promise<MarkdownRef> {
  if (typeof text !== "string")
    throw failure("invalid", "ui.markdown needs the Markdown text");
  if (Buffer.byteLength(text) > MARKDOWN_LIMITS.textBytes)
    throw failure("invalid", "Markdown text exceeds 256 KB");
  const { base, remoteImages } = options ?? {};
  if (
    base !== undefined &&
    (typeof base !== "string" ||
      !(/^https?:\/\//i.test(base) || isAbsolute(base)))
  )
    throw failure(
      "invalid",
      "base must be an http(s) address or an absolute directory",
    );
  let images: Record<string, string> = {};
  if (remoteImages !== false) {
    const scan = await scope.runtime.host.ui.markdownScan(text, base ?? null);
    images = await fetchImages(scope.runtime, scan.images);
  }
  return new MarkdownHandle(scope, text, base ?? null, images);
}
