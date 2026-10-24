/**
 * Source resolvers: page URLs to stream URLs, or local files to a stream
 * this plugin generates, for `player.open`.
 */
import { failure, quiet } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import { resolvedStream } from "./stream.ts";
import type {
  FileResolverOptions,
  Resolver,
  ResolverOptions,
  Resolvers,
} from "./types.ts";

const isFiles = (options: ResolverOptions): options is FileResolverOptions =>
  "extensions" in options;

export const resolvers = (scope: ScopeImpl): Resolvers => ({
  add(options) {
    const runtime = scope.runtime;
    const registration = isFiles(options)
      ? runtime.host.sourceResolvers.register(
          { id: options.id, extensions: options.extensions },
          async ({ url, signal }) => {
            const stream = await options.resolve(url, signal);
            if (stream?.kind !== "stream")
              throw failure(
                "invalid",
                'a file resolver returns { kind: "stream", width, height, frame }',
              );
            return resolvedStream(scope, playerOf(runtime), stream, signal);
          },
        )
      : runtime.host.sourceResolvers.register(
          { id: options.id, schemes: options.schemes, hosts: options.hosts },
          ({ url, signal }) => options.resolve(url, signal),
        );
    let disposed = false;
    const handle: Resolver = {
      ready: quiet(
        runtime
          .starting(registration, (error) => scope.report(error))
          .then(() => {}),
      ),
      async dispose() {
        if (disposed) return;
        disposed = true;
        scope.forget(handle);
        const registered = await registration.catch(() => undefined);
        await registered?.dispose().catch(() => {});
      },
    };
    return scope.add(handle);
  },
});
