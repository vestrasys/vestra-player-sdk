#!/usr/bin/env node
/**
 * vestra-plugin: check, build, test and pack a Vestra Player plugin, and
 * keep its translations up to date.
 *
 *   vestra-plugin <check|build|test|pack> [plugin-dir...] [--version x.y.z] [--out dir]
 *   vestra-plugin i18n extract [plugin-dir...] [--locale <lang>]...
 *   vestra-plugin i18n check [plugin-dir...]
 *   vestra-plugin docs [path] [--page N]
 *   vestra-plugin docs --search <query> [--page N]
 *
 * A plugin directory holds manifest.json; the default is the current
 * directory. Works in any project that depends on @vestra-player/sdk.
 *
 *   check   strict type check of the plugin's .ts files and tests/*.ts
 *           (then every use of an API member whose capability manifest.json
 *           does not declare: file:line, member, capability; fails on any;
 *           --json prints the findings as JSON)
 *   build   check, then write dist/: .ts → .js with types stripped, other
 *           package files copied, dist/manifest.json with `version`
 *   test    node --test on tests/*.test.{ts,mjs}
 *   pack    build, then dist/ → <out>/<id>-<version>.vxp (a zip; default
 *           out: the current directory) with its sha256 and size
 *   docs    the SDK's documentation by path, for coding agents: `/` lists
 *           Overview, Guides and API, `/API/Media/Snapshot/dispose` is
 *           one member's whole documentation; --search <query> lists
 *           matching paths; at most 8 KB per answer, --page N for the rest
 *
 * Translations (docs/how-to/i18n.md). English is the source text; each
 * language is a gettext file locales/<lang>.po:
 *
 *   i18n extract  find the texts to translate (@tr in .slint files, the
 *                 texts handed to commands.add, osd.show, dialogs, settings
 *                 and panel titles, the manifest's display fields), write
 *                 locales/messages.pot and merge it into every
 *                 locales/<lang>.po (translations kept, vanished ones marked
 *                 obsolete); --locale <lang> starts a new language
 *   i18n check    coverage per language, placeholder and plural problems, a
 *                 stale messages.pot, and texts that cannot be translated
 *                 (composed in TypeScript, not literals, not English, Slint
 *                 text without @tr) as warnings; fails (exit 1) on a stale
 *                 messages.pot, a .po missing messages, an unreadable file
 *
 * `check` prints the same i18n warnings when the plugin has locales/;
 * `build` compiles locales/<lang>.po to dist/locales/<lang>.json (the .po
 * files themselves are not packed).
 *
 * Every command first checks manifest.json against the player's rules
 * (display fields, paths inside the package, unknown fields); `check` also
 * prints hints, such as an id without the `<owner>.` prefix the official
 * repository needs.
 *
 * Type checking extends the nearest tsconfig.json at or above the plugin
 * directory (up to the repository root), else built-in strict settings; only
 * the plugin's own files are checked. The compiler is the SDK's own
 * TypeScript 5.x dependency.
 *
 * Per-plugin options live in the plugin's package.json under "vestra":
 *   { "bundle": true | { "external": [...] }, "assets": ["vendor"] }
 * `bundle` bundles the entry with the plugin's own esbuild dependency;
 * `assets` copies extra files or directories verbatim. The manifest's `icon`,
 * `readme` and `changelog` (and README.md / CHANGELOG.md when present) are
 * copied into the package too. The version comes from --version, else
 * manifest.json, else package.json.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync as exists } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const sdkRoot = resolve(import.meta.dirname, "..");
const { manifestProblems } = await import(
  pathToFileURL(join(sdkRoot, "dist/manifest.js")).href
);
const i18n = await import(pathToFileURL(join(sdkRoot, "dist/i18n.js")).href);
const i18nTools = await import(
  pathToFileURL(join(sdkRoot, "dist/i18n-tools.js")).href
);
const capabilityCheck = await import(
  pathToFileURL(join(sdkRoot, "dist/capability-check.js")).href
);
const SDK = "@vestra-player/sdk";

/** Never part of a production package. */
const SKIP_DIRS = new Set([
  "dist",
  "node_modules",
  "tests",
  "vendor",
  "evidence",
  ".build",
  ".typecheck",
]);
const SKIP_FILES = new Set([
  "manifest.json",
  "package.json",
  "package-lock.json",
]);
// Translation sources: build packs the compiled dist/locales/<lang>.json.
const SKIP_EXTENSIONS = new Set([".md", ".log", ".zip", ".vxp", ".po", ".pot"]);
const isTypeScript = (file) => file.endsWith(".ts") && !file.endsWith(".d.ts");
const isDeclaration = (file) => /\.d\.(m|c)?ts$/.test(file);

/** Strict settings for a project without its own tsconfig.json. */
const DEFAULT_COMPILER_OPTIONS = {
  target: "ES2023",
  module: "NodeNext",
  moduleResolution: "NodeNext",
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  verbatimModuleSyntax: true,
  erasableSyntaxOnly: true,
  skipLibCheck: true,
};

function fail(message) {
  throw Object.assign(new Error(message), { expected: true });
}

async function json(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

/** A module from the plugin's project first, else the SDK's own dependencies. */
/**
 * Whether a path exists. Under Node's permission model (`--permission`)
 * `existsSync` throws for a path outside the allowed ones; such a path
 * counts as absent, as for a user who cannot read it.
 */
function present(path) {
  try {
    return exists(path);
  } catch (error) {
    if (error?.code === "ERR_ACCESS_DENIED") return false;
    throw error;
  }
}

function resolveFrom(directory, specifier) {
  for (const base of [directory, sdkRoot]) {
    try {
      return createRequire(join(base, "package.json")).resolve(specifier);
    } catch {}
  }
  return null;
}

/**
 * The SDK's own TypeScript (a 5.x dependency): checks and builds do not change
 * with whatever compiler the plugin project uses for its editor, and need the
 * JavaScript compiler API (transpileModule), which TypeScript 7 does not ship.
 */
function compiler(file) {
  try {
    return createRequire(join(sdkRoot, "package.json")).resolve(file);
  } catch {
    fail(`${file} not found; reinstall @vestra-player/sdk`);
  }
}

async function typescript() {
  return (await import(pathToFileURL(compiler("typescript")).href)).default;
}

async function plugin(path) {
  const directory = resolve(path);
  const name = relative(process.cwd(), directory) || basename(directory);
  if (!present(join(directory, "manifest.json")))
    fail(`${name}: no manifest.json in ${directory}`);
  const manifest = await json(join(directory, "manifest.json"));
  const { problems, hints } = manifestProblems(manifest, directory);
  if (problems.length) fail(`${name}: manifest.json: ${problems.join("; ")}`);
  const packageJson = await json(join(directory, "package.json"), {});
  return {
    name,
    directory,
    manifest,
    hints,
    packageJson,
    options: packageJson.vestra ?? {},
  };
}

/** The documents and icon the manifest names (or the default README / CHANGELOG). */
function displayFiles(target) {
  const files = new Set();
  for (const field of ["icon", "readme", "changelog"])
    if (typeof target.manifest[field] === "string")
      files.add(target.manifest[field].split("/").join(sep));
  for (const name of ["README.md", "CHANGELOG.md"]) {
    const field = name === "README.md" ? "readme" : "changelog";
    if (
      target.manifest[field] === undefined &&
      present(join(target.directory, name))
    )
      files.add(name);
  }
  return files;
}

async function files(root, directory = root, keep = () => false) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    const rel = relative(root, path);
    // By name, so a symlinked node_modules is skipped too.
    if ((item.name.startsWith(".") || SKIP_DIRS.has(item.name)) && !keep(rel))
      continue;
    if (item.isDirectory()) result.push(...(await files(root, path, keep)));
    else result.push(rel);
  }
  return result;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** npm dependencies are installed from the lock file when missing. */
function dependencies(target, quiet = false) {
  const deps = {
    ...target.packageJson.dependencies,
    ...target.packageJson.devDependencies,
  };
  if (
    !Object.keys(deps).length ||
    present(join(target.directory, "node_modules"))
  )
    return;
  (quiet ? console.error : console.log)(
    `${target.name}: installing dependencies (npm ci)`,
  );
  // npm is npm.cmd on Windows, which spawn only runs through a shell.
  if (
    run("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: target.directory,
      shell: process.platform === "win32",
      ...(quiet ? { stdio: ["ignore", process.stderr, "inherit"] } : {}),
    }) !== 0
  )
    fail(
      `${target.name}: npm ci failed; fix package-lock.json or install the dependencies`,
    );
}

/** Directories from `directory` up to the repository (or file system) root. */
function* upwards(directory) {
  for (let current = directory; ;) {
    yield current;
    const parent = dirname(current);
    if (parent === current || present(join(current, ".git"))) return;
    current = parent;
  }
}

/**
 * A throwaway tsconfig limited to the plugin's files. It lives outside the
 * plugin, so type roots are listed explicitly: every node_modules/@types from
 * the plugin up, then the SDK's own @types/node.
 */
function checkConfig(target, sources) {
  const roots = [];
  for (const directory of upwards(target.directory)) {
    const types = join(directory, "node_modules/@types");
    if (present(types)) roots.push(types);
  }
  const node = resolveFrom(target.directory, "@types/node/package.json");
  if (node) roots.push(dirname(dirname(node)));
  const base = [...upwards(target.directory)]
    .map((directory) => join(directory, "tsconfig.json"))
    .find((file) => present(file));
  return {
    ...(base ? { extends: base } : {}),
    compilerOptions: {
      ...(base ? {} : DEFAULT_COMPILER_OPTIONS),
      ...(base || !node ? {} : { types: ["node"] }),
      noEmit: true,
      typeRoots: [...new Set(roots)],
    },
    include: [],
    files: sources,
  };
}

async function check(target, report = null) {
  const say = report ? () => {} : (line) => console.log(line);
  for (const hint of target.hints ?? []) say(`${target.name}: hint: ${hint}`);
  dependencies(target, !!report);
  const own = (await files(target.directory)).filter(
    (file) => isTypeScript(file) || file.endsWith(".mts"),
  );
  const tests = present(join(target.directory, "tests"))
    ? (await readdir(join(target.directory, "tests")))
        .filter(isTypeScript)
        .map((file) => join("tests", file))
    : [];
  const sources = [...own, ...tests].map((file) =>
    join(target.directory, file),
  );
  if (!sources.length) {
    say(`${target.name}: no TypeScript to check`);
    report?.push({ plugin: target.name, findings: [] });
    return;
  }
  const tsc = compiler("typescript/lib/tsc.js");
  const scratch = await mkdtemp(join(tmpdir(), "vestra-plugin-check-"));
  let findings;
  try {
    const config = join(scratch, "tsconfig.json");
    await writeFile(config, JSON.stringify(checkConfig(target, sources)));
    if (
      run(process.execPath, [tsc, "-p", config], {
        stdio: report ? ["ignore", process.stderr, "inherit"] : "inherit",
      }) !== 0
    )
      fail(`${target.name}: type check failed`);
    say(`${target.name}: type check passed (${sources.length} files)`);
    findings = await capabilityFindings(target, config);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  if (report) report.push({ plugin: target.name, findings });
  else
    for (const finding of findings)
      console.error(
        `${relative(process.cwd(), finding.file) || finding.file}:${finding.line}:${finding.column}: ${finding.message} (request ${finding.method})`,
      );
  if (findings.length) {
    const missing = [...new Set(findings.map((each) => each.capability))];
    fail(
      `${target.name}: ${findings.length} use${findings.length === 1 ? "" : "s"} of undeclared capabilities; add ${missing.map((each) => `"${each}"`).join(", ")} to manifest.json "capabilities" (or stop using those members)`,
    );
  }
  say(`${target.name}: capabilities declared for every API use`);
  if (report) return;
  for (const line of [
    ...(await bottomBarWarnings(target)),
    ...(await forWarnings(target)),
  ])
    console.log(`${target.name}: warning: ${line}`);
  // Translation warnings never fail the check.
  if (present(join(target.directory, "locales"))) {
    try {
      const { warnings, errors } = await i18nReport(target);
      for (const line of [...warnings, ...errors])
        console.log(`${target.name}: i18n: ${line}`);
    } catch (error) {
      console.log(`${target.name}: i18n: ${error.message}`);
    }
  }
}

/**
 * Uses of API members whose capability the manifest does not declare, in
 * the plugin's production files (not tests/), with the type check's
 * compiler options (src/capability-check.ts).
 */
async function capabilityFindings(target, config) {
  const ts = await typescript();
  const parsed = ts.getParsedCommandLineOfConfigFile(
    config,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
        fail(
          `${target.name}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
        ),
    },
  );
  const files = (await sourceFiles(target)).typescript.map((file) =>
    join(target.directory, file),
  );
  if (!parsed || !files.length) return [];
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const capabilities = Array.isArray(target.manifest.capabilities)
    ? target.manifest.capabilities
    : [];
  return capabilityCheck
    .findUndeclaredCapabilities(ts, program, { files, capabilities })
    .map((finding) => ({ ...finding, file: resolve(finding.file) }));
}

/** Slint source without its comments (string literals kept as they are). */
function slintCode(text) {
  let out = "";
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (text.startsWith("//", i)) {
      const next = text.indexOf("\n", i);
      i = next < 0 ? text.length : next;
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
      out += " ";
    } else out += text[i++];
  }
  return out;
}

/** Whether `path` lies inside `directory` (not a sibling sharing its prefix). */
function inside(directory, path) {
  const rel = relative(resolve(directory), path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Whether the Slint file at `file` (relative to the plugin directory)
 * imports `BarButtons` from `@vestra/bar-buttons.slint`, itself or
 * through the plugin's own Slint files (relative paths, any depth, inside
 * the plugin directory). Local re-exports count as such files too:
 * `export { Row } from "row.slint"` and `export * from "row.slint"` are
 * followed, and `export { BarButtons } from "@vestra/bar-buttons.slint"` (or
 * `export * from` it) in a file the bar imports counts as placing it.
 * Comments do not count.
 */
async function importsBarButtons(target, file, seen = new Set()) {
  const path = resolve(target.directory, file);
  if (seen.has(path) || !inside(target.directory, path)) return false;
  seen.add(path);
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return false;
  const code = slintCode(text);
  // { names (or "*"), from }: imports, and re-exports with a source file.
  const imports = [
    ...code.matchAll(
      /\b(?:import|export)\s*(?:(\*)\s*from\s*|\{([^}]*)\}\s*from\s*)?"([^"]+)"/g,
    ),
  ].map(([, star, names, from]) => ({ names: star ?? names ?? "", from }));
  for (const { names, from } of imports)
    if (
      from === "@vestra/bar-buttons.slint" &&
      (names === "*" ||
        names
          .split(",")
          .some((name) => /^BarButtons(\s+as\s+[\w-]+)?$/.test(name.trim())))
    )
      return true;
  for (const { from } of imports) {
    if (
      from.startsWith("@") ||
      !from.endsWith(".slint") ||
      from === "std-widgets.slint"
    )
      continue;
    if (await importsBarButtons(target, join(dirname(file), from), seen))
      return true;
  }
  return false;
}

/**
 * A plugin that mounts a bottom bar (`panels.mount("bottom", "<file>")`)
 * whose Slint file does not import `BarButtons` (`@vestra/bar-buttons.slint`),
 * itself or through its local imports: while it is the bottom bar, no
 * plugin's command button shows (SDK 1.5.29). The mount is read from the
 * source text: a literal file name in the call.
 */
async function bottomBarWarnings(target) {
  const { typescript: sources } = await sourceFiles(target);
  const files = new Set();
  for (const file of sources) {
    const text = await readFile(join(target.directory, file), "utf8");
    for (const match of text.matchAll(
      /\.mount\(\s*["'`]bottom["'`]\s*,\s*["'`]([^"'`$]+)["'`]/g,
    ))
      files.add(match[1]);
  }
  const warnings = [];
  for (const file of files) {
    if (!present(join(target.directory, file))) continue;
    if (await importsBarButtons(target, file)) continue;
    warnings.push(
      `${file} is a bottom bar without BarButtons (import { BarButtons } from "@vestra/bar-buttons.slint"): while it is mounted, the command buttons of every plugin (and the player's sidebar toggle) show nowhere; see docs/guidelines/interface.md#writing-a-bottom-bar`,
    );
  }
  return warnings;
}

/**
 * A `for` over an array the plugin binds (an `in` or `in-out` property of
 * array type of a component or global in the same file), outside a
 * `ListView`, in the plugin's .slint files: a reminder, not a failure
 * (SDK 1.5.46). Such a `for` builds every row of the array up front; since
 * player 0.6.0 a plugin may bind a whole long list, which belongs in a
 * `ListView` (it builds only the rows on screen). A text scan: imported
 * components and `@children` are not followed.
 */
async function forWarnings(target) {
  const { slint } = await sourceFiles(target);
  const warnings = [];
  for (const file of slint) {
    const text = slintCode(
      await readFile(join(target.directory, file), "utf8"),
    );
    const arrays = new Set(
      [
        ...text.matchAll(
          /\b(?:in|in-out)\s+property\s*<\s*\[[^\]]*\]\s*>\s*([A-Za-z_][\w-]*)/g,
        ),
      ].map((match) => match[1]),
    );
    if (!arrays.size) continue;
    // The elements open at each point: the name before each `{`.
    const open = [];
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "\n") line++;
      else if (c === "{") {
        const name = /([A-Za-z_][\w-]*)\s*$/.exec(
          text.slice(Math.max(0, i - 80), i),
        );
        open.push(name ? name[1] : "");
      } else if (c === "}") open.pop();
      else if (
        text.startsWith("for", i) &&
        !/[\w-]/.test(text[i - 1] ?? " ") &&
        /\s/.test(text[i + 3] ?? "")
      ) {
        const loop =
          /^for\s+[\w-]+(?:\s*\[\s*[\w-]+\s*\])?\s+in\s+([\w.-]+)/.exec(
            text.slice(i, i + 200),
          );
        const array = loop?.[1].split(".").at(-1);
        if (array && arrays.has(array) && !open.includes("ListView"))
          warnings.push(
            `${file.replaceAll("\\", "/")}:${line}: \`for\` over the bound array \`${array}\` outside a ListView builds every row; a long list should use a ListView (docs/reference/limits.md)`,
          );
      }
    }
  }
  return warnings;
}
/** The plugin's own production .ts / .mts and .slint files. */
async function sourceFiles(target) {
  const all = await files(target.directory);
  return {
    typescript: all.filter(
      (file) =>
        (isTypeScript(file) || file.endsWith(".mts")) && !isDeclaration(file),
    ),
    slint: all.filter((file) => file.endsWith(".slint")),
  };
}

/** Compiler options of the type check (its tsconfig), for extraction. */
async function extraction(target) {
  const ts = await typescript();
  const { typescript: sources, slint } = await sourceFiles(target);
  const config = checkConfig(
    target,
    sources.map((file) => join(target.directory, file)),
  );
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    target.directory,
  );
  return i18nTools.extract({
    directory: target.directory,
    manifest: target.manifest,
    slint,
    typescript: sources,
    compilerOptions: parsed.options,
  });
}

async function i18nReport(target) {
  const { messages, findings } = await extraction(target);
  return i18nTools.checkCatalogs(target.directory, messages, findings);
}

async function i18nExtract(target, locales) {
  for (const locale of locales) {
    if (locale === "en")
      fail("--locale en: English is the source language, it has no .po file");
    if (!i18n.LOCALES.includes(locale))
      fail(
        `--locale ${locale}: the player's languages are ${i18n.LOCALES.filter((l) => l !== "en").join(", ")}`,
      );
  }
  dependencies(target);
  const { messages, findings } = await extraction(target);
  const directory = join(target.directory, "locales");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "messages.pot"),
    i18nTools.template(target.manifest, messages),
  );
  console.log(
    `${target.name}: locales/messages.pot: ${messages.length} messages`,
  );
  const languages = new Set(locales);
  for (const name of await readdir(directory))
    if (name.endsWith(".po")) languages.add(name.slice(0, -3));
  for (const language of [...languages].sort()) {
    if (language === "en" || !i18n.LOCALES.includes(language)) {
      console.log(
        `${target.name}: locales/${language}.po: skipped (not a player language)`,
      );
      continue;
    }
    const file = join(directory, `${language}.po`);
    let existing = null;
    if (present(file)) existing = await readFile(file, "utf8");
    let merged;
    try {
      merged = i18nTools.merge(existing, language, messages);
    } catch (error) {
      fail(`${target.name}: locales/${language}.po: ${error.message}`);
    }
    await writeFile(file, merged.text);
    console.log(
      `${target.name}: locales/${language}.po: ${merged.translated}/${merged.total} translated, ${merged.added} new, ${merged.obsolete} obsolete${existing === null ? " (created)" : ""}`,
    );
  }
  for (const finding of findings)
    console.log(
      `${target.name}: i18n: ${finding.file}:${finding.line}: ${finding.message}`,
    );
}

async function i18nCheck(target) {
  dependencies(target);
  const { warnings, errors } = await i18nReport(target);
  for (const line of warnings) console.log(`${target.name}: i18n: ${line}`);
  // A stale messages.pot, a .po missing messages, an unreadable file.
  if (errors.length) fail(`${target.name}: i18n: ${errors.join("; ")}`);
  if (!warnings.length) console.log(`${target.name}: i18n: no problems`);
}

function version(target, flag) {
  const value = flag ?? target.manifest.version ?? target.packageJson.version;
  if (!value)
    fail(`${target.name}: add "version" to manifest.json or pass --version`);
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ||
    value.split(".").some((part) => BigInt(part) > 4294967295n)
  )
    fail(
      `${target.name}: version ${value} needs three u32 components without leading zeros`,
    );
  return value;
}

/** The source of the entry: a dev manifest may point at main.ts or dist/main.js. */
function entries(target) {
  if (typeof target.manifest.entry !== "string")
    fail(`${target.name}: manifest.json has no "entry"`);
  const entry = target.manifest.entry.replace(/^dist\//, "");
  const candidates = [entry.replace(/\.js$/, ".ts"), entry];
  const found = candidates.find((file) =>
    present(join(target.directory, file)),
  );
  if (!found)
    fail(`${target.name}: entry ${target.manifest.entry} has no source file`);
  return { source: found, built: found.replace(/\.ts$/, ".js") };
}

function transpile(ts, text, file) {
  const output = ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
      rewriteRelativeImportExtensions: true,
    },
  });
  if (output.diagnostics?.length)
    fail(
      `${file}: ${ts.flattenDiagnosticMessageText(output.diagnostics[0].messageText, "\n")}`,
    );
  return output.outputText;
}

/**
 * The player hands the SDK to the plugin at run time: production code may
 * only `import type` it, and a built plugin contains only its own code.
 */
function noRuntimeSdk(ts, file, text) {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const specifiers = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  const offending = specifiers.find(
    (spec) => spec === SDK || spec.startsWith(`${SDK}/`),
  );
  if (offending)
    fail(`${file}: runtime import of ${offending}; use "import type"`);
}

async function bundle(target, entry, out) {
  let esbuild;
  try {
    const require = createRequire(join(target.directory, "package.json"));
    esbuild = await import(pathToFileURL(require.resolve("esbuild")).href);
  } catch {
    fail(
      `${target.name}: "bundle" needs esbuild in the plugin's own dependencies`,
    );
  }
  const options =
    typeof target.options.bundle === "object" ? target.options.bundle : {};
  await esbuild.build({
    entryPoints: [join(target.directory, entry.source)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Kept visible so noRuntimeSdk() refuses it instead of bundling a copy.
    external: [...(options.external ?? []), SDK, `${SDK}/*`],
    // Bundled CommonJS dependencies still call require().
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    outfile: join(out, entry.built),
    logLevel: "warning",
  });
}

async function build(target, flag) {
  const release = version(target, flag);
  await check(target);
  const ts = await typescript();
  const out = join(target.directory, "dist");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const entry = entries(target);
  const assets = target.options.assets ?? [];
  const display = displayFiles(target);
  const listed = (rel) =>
    display.has(rel) ||
    assets.some((asset) => rel === asset || rel.startsWith(asset + sep));
  const bundled = !!target.options.bundle;
  if (bundled) await bundle(target, entry, out);
  for (const file of await files(target.directory, target.directory, listed)) {
    const name = basename(file);
    const destination = join(out, file);
    if (!listed(file)) {
      if (
        SKIP_FILES.has(name) ||
        SKIP_EXTENSIONS.has(extname(name)) ||
        /^tsconfig.*\.json$/.test(name)
      )
        continue;
      if (isDeclaration(name)) continue;
      // Code reaches the bundle through the entry's imports.
      if (bundled && /\.(m|c)?[jt]s$/.test(name)) continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    if (isTypeScript(file) && !listed(file)) {
      const text = transpile(
        ts,
        await readFile(join(target.directory, file), "utf8"),
        file,
      );
      noRuntimeSdk(ts, file, text);
      await writeFile(destination.replace(/\.ts$/, ".js"), text);
    } else await cp(join(target.directory, file), destination);
  }
  if (bundled)
    noRuntimeSdk(
      ts,
      entry.built,
      await readFile(join(out, entry.built), "utf8"),
    );
  let localeWarnings;
  try {
    localeWarnings = i18nTools.compileLocales(target.directory, out);
  } catch (error) {
    fail(`${target.name}: ${error.message}`);
  }
  for (const line of localeWarnings)
    console.log(`${target.name}: warning: ${line}`);
  await writeFile(join(out, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(out, "manifest.json"),
    `${JSON.stringify({ ...target.manifest, entry: entry.built, version: release }, null, 2)}\n`,
  );
  console.log(
    `${target.name}: built ${relative(process.cwd(), out) || "."} version ${release}`,
  );
  return { out, version: release };
}

async function test(target) {
  const directory = join(target.directory, "tests");
  const tests = present(directory)
    ? (await readdir(directory))
        .filter((file) => /\.test\.(ts|mjs)$/.test(file))
        .sort()
    : [];
  if (!tests.length)
    fail(`${target.name}: no tests/*.test.ts or tests/*.test.mjs`);
  dependencies(target);
  if (
    run(
      process.execPath,
      ["--test", ...tests.map((file) => join(directory, file))],
      // startPlugin says why a plugin would keep running while idle.
      {
        cwd: target.directory,
        env: { ...process.env, VESTRA_PLUGIN_RESIDENCY: "1" },
      },
    ) !== 0
  )
    fail(`${target.name}: tests failed`);
}

/** A deterministic zip (sorted entries, fixed timestamps, deflate). */
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  // 1980-01-01 00:00, the earliest DOS date: the same input gives the same bytes.
  const time = 0;
  const date = (0 << 9) | (1 << 5) | 1;
  for (const { name, data } of entries) {
    const path = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(path.length, 26);
    header.writeUInt16LE(0, 28);
    local.push(header, path, compressed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(compressed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(path.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, path);
    offset += header.length + path.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function pack(target, flag, outDirectory) {
  const { out, version: release } = await build(target, flag);
  const names = (await files(out, out, () => true)).sort();
  const archive = zip(
    await Promise.all(
      names.map(async (name) => ({
        name: name.split(sep).join("/"),
        data: await readFile(join(out, name)),
      })),
    ),
  );
  const destination = resolve(outDirectory ?? ".");
  await mkdir(destination, { recursive: true });
  const file = join(destination, `${target.manifest.id}-${release}.vxp`);
  await writeFile(file, archive);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  console.log(
    `${target.name}: packed ${relative(process.cwd(), file) || file} (${archive.length} bytes, sha256 ${sha256})`,
  );
}

const USAGE = [
  "usage: vestra-plugin <check|build|test|pack> [plugin-dir...] [--version x.y.z] [--out dir]",
  "       vestra-plugin check [plugin-dir...] --json",
  "       vestra-plugin i18n extract [plugin-dir...] [--locale <lang>]...",
  "       vestra-plugin i18n check [plugin-dir...]",
  "       vestra-plugin docs [path] [--page N]",
  "       vestra-plugin docs --search <query> [--page N]",
].join("\n");

/** `vestra-plugin docs`: `@vestra-player/sdk/docs` on the command line. */
async function docsCommand(args) {
  const index = args.indexOf("--page");
  let page;
  if (index >= 0) {
    const [, value] = args.splice(index, 2);
    page = Number(value);
    if (!Number.isInteger(page) || page < 1)
      fail("--page needs a page number (1, 2, …)");
  }
  const { docs, searchDocs } = await import(
    pathToFileURL(join(sdkRoot, "dist/docs.js")).href
  );
  const search = args.indexOf("--search");
  if (search >= 0) {
    args.splice(search, 1);
    if (!args.length) fail("--search needs words to search for");
    console.log(searchDocs(args.join(" "), { page }));
    return;
  }
  // A path with spaces may come as several arguments.
  console.log(docs(args.length ? args.join(" ") : "/", { page }));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const option = (name) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const [, value] = args.splice(index, 2);
    if (value === undefined) fail(`${name} needs a value`);
    return value;
  };
  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }
  if (command === "docs") {
    await docsCommand(args);
    return;
  }
  let subcommand = null;
  if (command === "i18n") {
    subcommand = args.shift();
    if (!["extract", "check"].includes(subcommand)) {
      console.error(USAGE);
      process.exit(2);
    }
  } else if (!["check", "build", "test", "pack"].includes(command)) {
    console.error(USAGE);
    process.exit(2);
  }
  const locales = [];
  for (let index; (index = args.indexOf("--locale")) >= 0;) {
    const [, value] = args.splice(index, 2);
    if (value === undefined) fail("--locale needs a value");
    locales.push(value);
  }
  if (locales.length && subcommand !== "extract")
    fail("--locale applies to i18n extract");
  const jsonIndex = args.indexOf("--json");
  const report = jsonIndex >= 0 ? [] : null;
  if (report) {
    args.splice(jsonIndex, 1);
    if (command !== "check") fail("--json applies to check");
  }
  const flag = option("--version");
  const out = option("--out");
  const directories = args.length ? args : ["."];
  if (flag && directories.length > 1)
    fail("--version applies to a single plugin");
  const failed = [];
  for (const directory of directories) {
    const reported = report?.length ?? 0;
    try {
      const target = await plugin(directory);
      if (subcommand === "extract") await i18nExtract(target, locales);
      else if (subcommand === "check") await i18nCheck(target);
      else if (command === "check") await check(target, report);
      else if (command === "build") await build(target, flag);
      else if (command === "pack") await pack(target, flag, out);
      else await test(target);
    } catch (error) {
      if (!error.expected) throw error;
      console.error(`✖ ${error.message}`);
      failed.push(directory);
      if (report) {
        if (report.length === reported) report.push({ findings: [] });
        report[reported].error = error.message;
      }
    }
    if (report) report[reported] = { directory, ...report[reported] };
  }
  if (report) console.log(JSON.stringify(report, null, 2));
  if (failed.length) {
    console.error(
      `${subcommand ? `i18n ${subcommand}` : command} failed for: ${failed.join(", ")}`,
    );
    process.exit(1);
  }
}

try {
  await main();
} catch (error) {
  if (!error.expected) throw error;
  console.error(`✖ ${error.message}`);
  process.exit(1);
}
