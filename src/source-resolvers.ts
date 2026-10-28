/** Trusted extraction providers. Declarations cross JSON; handler code stays in JS. */
import { isTextValue, textProblem } from "./i18n.ts";
import type { ListJson, TextJson } from "./i18n.ts";
import type { Transport } from "./wire.ts";
/** One stream of a {@link ResolvedMedia}. */
export type ResolvedResource = {
  /** The playable stream URL. */
  url: string;
  /** HTTP headers for requests to `url` (e.g. a referer or cookie). */
  headers?: Record<string, string>;
};
/**
 * What a resolver returns ({@link WebResolverOptions.resolve}): the playable
 * stream(s) behind a page URL. Both streams must use identical `headers`;
 * different maps fail explicitly (nothing is dropped silently).
 *
 * @example Play a page whose video and audio are separate streams
 * Opening a `https://video.example/…` page plays it with its title. When
 * the user opens a URL whose scheme and host a web resolver declares, the
 * player calls its `resolve(url, signal)`; the plugin looks up the streams
 * and returns them, and the player plays `primary` with the separate
 * `audio` track, sending the `headers` with every request for both.
 * ```ts
 * plugin.resolvers.add({
 *   id: "video-example",
 *   schemes: ["https"],
 *   hosts: ["video.example"],
 *   async resolve(url, signal) {
 *     // The site's own API (made up here) names the streams of a page.
 *     const api = `https://video.example/api/streams?page=${encodeURIComponent(url)}`;
 *     const response = await fetch(api, { signal });
 *     // The player shows a failed resolve's message to the user.
 *     if (!response.ok)
 *       throw new Error(`video.example answered ${response.status} for this page`);
 *     const info = (await response.json()) as {
 *       title: string;
 *       video: string;
 *       audio: string;
 *     };
 *     const headers = { Referer: url }; // identical for both streams
 *     const media: ResolvedMedia = {
 *       kind: "media",
 *       originalUrl: url,
 *       title: info.title,
 *       primary: { url: info.video, headers },
 *       audio: { url: info.audio, headers },
 *     };
 *     return media;
 *   },
 * });
 * ```
 */
export type ResolvedMedia = {
  /** Always `"media"`. */
  kind: "media";
  /** The page URL that was resolved. */
  originalUrl: string;
  /** A title for the player to show. */
  title?: string;
  /** The video (or combined) stream. */
  primary: ResolvedResource;
  /** A separate audio stream, when audio and video are split. */
  audio?: ResolvedResource;
};
/**
 * A resolver declaration on the wire: a web resolver (`schemes` + `hosts`)
 * or, from player 0.4.1, a file resolver (`extensions`), never both.
 */
export type SourceResolverDeclaration =
  | {
      id: string;
      /** Finite initial contract: http and/or https, exact normalized host names. */
      schemes: ("http" | "https")[];
      hosts: string[];
    }
  | {
      id: string;
      /** Local files by extension: 1–16, lower-case letters or digits, no dot. */
      extensions: string[];
    };
/**
 * A file resolver's answer as the handler gives it: the producer it prepared
 * (sent to the host), `accepted` once the host selected it (with the stamp of
 * the source it became) and `abandoned` when it never will be: the request
 * was cancelled or answered too late. Exactly one of the two is called.
 */
export type ResolvedProducer = {
  kind: "stream";
  producerId: number;
  accepted(reply: {
    stamp: { generation: number; intentVersion: number };
  }): Promise<void>;
  abandoned(): Promise<void>;
};
const isProducer = (result: unknown): result is ResolvedProducer =>
  (result as ResolvedProducer | null)?.kind === "stream";
/** The words of a failure, as the user will read them. */
const reason = (error: unknown): string | TextJson | ListJson => {
  // `plugin.i18n.error(…)`: the player shows the text translated.
  const text = (error as { text?: unknown } | null)?.text;
  if (error instanceof Error && isTextValue(text) && !textProblem(text))
    return text;
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2048,
  );
};
export function sourceResolverClient(transport: Transport) {
  return {
    /** Requires source.resolve. One registered host/scheme pair, and one file
     * extension, has one owner (another plugin: `conflict`, reason
     * `resolver-taken`). Resolution shares source.submit arbitration and the
     * original operation ID. This backend supports paired streams with
     * identical header maps; different maps fail explicitly. No header is
     * silently discarded or made global. A failure is sent as its message. */
    async register(
      declaration: SourceResolverDeclaration,
      handler: (request: {
        url: string;
        signal: AbortSignal;
      }) => Promise<ResolvedMedia | ResolvedProducer>,
    ) {
      const active = new Map<number, AbortController>();
      let disposed = false;
      const offRequest = transport.on("source.resolveRequest", (value) => {
        const request = value as {
          requestId: number;
          resolverId: string;
          url: string;
        };
        if (request.resolverId !== declaration.id || disposed) return;
        const controller = new AbortController();
        active.set(request.requestId, controller);
        const live = () => !controller.signal.aborted && !disposed;
        void (async () => {
          let result: ResolvedMedia | ResolvedProducer;
          try {
            result = await handler({
              url: request.url,
              signal: controller.signal,
            });
          } catch (error) {
            if (live())
              await transport
                .request("sourceResolvers.respond", {
                  requestId: request.requestId,
                  error: reason(error),
                })
                .catch(() => {});
            active.delete(request.requestId);
            return;
          }
          try {
            if (!isProducer(result)) {
              if (live())
                await transport.request("sourceResolvers.respond", {
                  requestId: request.requestId,
                  result,
                });
              return;
            }
            if (!live()) return void (await result.abandoned());
            let reply: { stamp: { generation: number; intentVersion: number } };
            try {
              // Answered: the host no longer cancels this request.
              active.delete(request.requestId);
              reply = await transport.request("sourceResolvers.respond", {
                requestId: request.requestId,
                result: { kind: "stream", producerId: result.producerId },
              });
            } catch (error) {
              await result.abandoned();
              throw error;
            }
            await result.accepted(reply);
          } finally {
            active.delete(request.requestId);
          }
        })().catch(() => {});
      });
      const offCancel = transport.on("source.resolveCancel", (value) => {
        const request = value as { requestId: number; resolverId: string };
        if (request.resolverId === declaration.id) {
          active.get(request.requestId)?.abort();
          active.delete(request.requestId);
        }
      });
      try {
        await transport.request("sourceResolvers.register", declaration);
      } catch (error) {
        offRequest();
        offCancel();
        throw error;
      }
      return {
        async dispose() {
          if (disposed) return;
          disposed = true;
          for (const controller of active.values()) controller.abort();
          active.clear();
          offRequest();
          offCancel();
          await transport.request("sourceResolvers.unregister", {
            id: declaration.id,
          });
        },
      };
    },
  };
}
