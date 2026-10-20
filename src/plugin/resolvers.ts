/** Source resolvers turn page URLs into stream URLs for `player.open`. */
import { quiet } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Resolver, Resolvers } from "./types.ts";

export const resolvers = (scope: ScopeImpl): Resolvers => ({
  add(options) {
    const { resolve, ...declaration } = options;
    const runtime = scope.runtime;
    const registration = runtime.host.sourceResolvers.register(
      declaration,
      ({ url, signal }) => resolve(url, signal),
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
