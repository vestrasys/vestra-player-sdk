/** `plugin.i18n`: the interface language of this run (read-only). */
import type { ScopeImpl } from "./scope.ts";
import type { I18n } from "./types.ts";

export const i18n = (scope: ScopeImpl): I18n =>
  Object.freeze({
    get locale() {
      return scope.runtime.locale;
    },
  });
