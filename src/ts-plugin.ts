/**
 * The TypeScript language-service plugin `@vestra-player/sdk/ts-plugin`: the
 * capability checker of `vestra-plugin check` in the editor. A use of an API
 * member whose capability `manifest.json` does not declare is an error at
 * the member, with the quick fix "Add '<capability>' to manifest.json".
 *
 * A project enables it in its tsconfig.json:
 *
 *   { "compilerOptions": { "plugins": [{ "name": "@vestra-player/sdk/ts-plugin" }] } }
 *
 * The editor must run the project's own TypeScript (VS Code: "TypeScript:
 * Select TypeScript Version" → "Use Workspace Version"); `tsc` ignores
 * language-service plugins, which is why `vestra-plugin check` runs the same
 * checker. The manifest is the nearest `manifest.json` above the file; files
 * in its `tests/`, `node_modules/`, `dist/` and `vendor/` are not checked.
 *
 * @internal
 */
import type TS from "typescript";
import {
  addCapabilityEdit,
  CAPABILITY_DIAGNOSTIC,
  findUndeclaredCapabilities,
  isPluginSource,
} from "./capability-check.ts";
import type { CapabilityFinding } from "./capability-check.ts";

const FIX_NAME = "vestraAddCapability";

/** The nearest manifest.json at or above a file, with its capabilities. */
function manifestFor(
  ts: typeof TS,
  file: string,
): { path: string; directory: string; capabilities: string[] } | undefined {
  let directory = file.replaceAll("\\", "/");
  for (;;) {
    const parent = directory.slice(0, directory.lastIndexOf("/"));
    if (!parent || parent === directory) return undefined;
    directory = parent;
    const path = `${directory}/manifest.json`;
    if (!ts.sys.fileExists(path)) continue;
    try {
      const manifest = JSON.parse(ts.sys.readFile(path) ?? "") as {
        capabilities?: unknown;
      };
      if (!Array.isArray(manifest.capabilities)) return undefined;
      return {
        path,
        directory,
        capabilities: manifest.capabilities.filter(
          (each): each is string => typeof each === "string",
        ),
      };
    } catch {
      return undefined;
    }
  }
}

/** @internal The plugin factory tsserver calls (`ts-plugin/index.js`). */
export default function init(modules: {
  typescript: typeof TS;
}): TS.server.PluginModule {
  const ts = modules.typescript;
  return {
    create(info) {
      const service = info.languageService;
      const log = (message: string) =>
        info.project?.projectService?.logger?.info(
          `[@vestra-player/sdk/ts-plugin] ${message}`,
        );
      const findings = (file: string): CapabilityFinding[] => {
        const manifest = manifestFor(ts, file);
        const program = service.getProgram();
        if (!manifest || !program || !isPluginSource(manifest.directory, file))
          return [];
        try {
          return findUndeclaredCapabilities(ts, program, {
            files: [file],
            capabilities: manifest.capabilities,
          });
        } catch (error) {
          log(`check failed: ${(error as Error).stack ?? String(error)}`);
          return [];
        }
      };
      const proxy = Object.create(null) as TS.LanguageService;
      for (const key of Object.keys(service) as (keyof TS.LanguageService)[]) {
        const member = service[key];
        (proxy as unknown as Record<string, unknown>)[key] =
          typeof member === "function" ? member.bind(service) : member;
      }
      proxy.getSemanticDiagnostics = (file) => {
        const prior = service.getSemanticDiagnostics(file);
        const source = service.getProgram()?.getSourceFile(file);
        return [
          ...prior,
          ...findings(file).map((finding): TS.Diagnostic => ({
            file: source,
            start: finding.start,
            length: finding.length,
            messageText: finding.message,
            category: ts.DiagnosticCategory.Error,
            code: CAPABILITY_DIAGNOSTIC,
            source: "vestra",
          })),
        ];
      };
      proxy.getSupportedCodeFixes = (file) => [
        ...service.getSupportedCodeFixes(file),
        String(CAPABILITY_DIAGNOSTIC),
      ];
      proxy.getCodeFixesAtPosition = (
        file,
        start,
        end,
        errorCodes,
        format,
        preferences,
      ) => {
        const prior = service.getCodeFixesAtPosition(
          file,
          start,
          end,
          errorCodes,
          format,
          preferences,
        );
        if (!errorCodes.includes(CAPABILITY_DIAGNOSTIC)) return prior;
        const manifest = manifestFor(ts, file);
        const text = manifest && ts.sys.readFile(manifest.path);
        if (!manifest || text === undefined) return prior;
        const wanted = new Set(
          findings(file)
            .filter(
              (finding) =>
                finding.start <= end && finding.start + finding.length >= start,
            )
            .map((finding) => finding.capability),
        );
        const fixes: TS.CodeFixAction[] = [];
        for (const capability of wanted) {
          const edit = addCapabilityEdit(ts, text, capability);
          if (!edit) continue;
          fixes.push({
            fixName: FIX_NAME,
            description: `Add '${capability}' to manifest.json`,
            changes: [
              {
                fileName: manifest.path,
                textChanges: [
                  {
                    span: { start: edit.start, length: edit.length },
                    newText: edit.newText,
                  },
                ],
              },
            ],
          });
        }
        return [...prior, ...fixes];
      };
      log("enabled");
      return proxy;
    },
  };
}
