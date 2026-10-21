/** Trusted extraction providers. Declarations cross JSON; handler code stays in JS. */
import type { Transport } from "./wire.ts";
/** One stream of a {@link ResolvedMedia}. */
export type ResolvedResource = {
  /** The playable stream URL. */
  url: string;
  /** HTTP headers for requests to `url` (e.g. a referer or cookie). */
  headers?: Record<string, string>;
};
/**
 * What a resolver returns ({@link ResolverOptions.resolve}): the playable
 * stream(s) behind a page URL. Both streams must use identical `headers`;
 * different maps fail explicitly (nothing is dropped silently).
 *
 * @example
 * ```ts
 * const media: ResolvedMedia = {
 *   kind: "media",
 *   originalUrl: url,
 *   title: "Talk",
 *   primary: { url: videoUrl, headers: { Referer: url } },
 *   audio: { url: audioUrl, headers: { Referer: url } },
 * };
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
export type SourceResolverDeclaration = {
  id: string;
  /** Finite initial contract: http and/or https, exact normalized host names. */
  schemes: ("http" | "https")[];
  hosts: string[];
};
export function sourceResolverClient(transport: Transport) {
  return {
    /** Requires source.resolve. One registered host/scheme pair has one owner.
     * Resolution shares source.submit arbitration and the original operation ID.
     * This backend supports paired streams with identical header maps; different
     * maps fail explicitly. No header is silently discarded or made global. */
    async register(
      declaration: SourceResolverDeclaration,
      handler: (request: {
        url: string;
        signal: AbortSignal;
      }) => Promise<ResolvedMedia>,
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
        void (async () => {
          try {
            const result = await handler({
              url: request.url,
              signal: controller.signal,
            });
            if (!controller.signal.aborted && !disposed) {
              await transport.request("sourceResolvers.respond", {
                requestId: request.requestId,
                result,
              });
            }
          } catch (error) {
            if (!controller.signal.aborted && !disposed) {
              await transport
                .request("sourceResolvers.respond", {
                  requestId: request.requestId,
                  error: String(error).slice(0, 2048),
                })
                .catch(() => {});
            }
          } finally {
            active.delete(request.requestId);
          }
        })();
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
