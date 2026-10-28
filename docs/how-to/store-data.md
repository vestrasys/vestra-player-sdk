---
title: Store a plugin's data
description: Choose between settings files, session values and the secret store, and use each one so that nothing is lost or leaked.
---

# Store a plugin's data

**Goal:** your plugin keeps its settings across restarts, keeps work in progress across a reload, and keeps an API token safe, each in the right place.

| What | Where | Lasts | Capability |
| --- | --- | --- | --- |
| Settings, history, small state | `plugin.storage.json(name)`: a JSON file in the data directory | Across player restarts and plugin upgrades | none |
| Work in progress for this run | `plugin.storage.session`: values in the player's memory | Across plugin restarts (reload, crash, upgrade), not across player restarts | none |
| Tokens, passwords | `plugin.secrets`: the system's keychain or Credential Manager | Until deleted | `secrets` |
| Anything else (caches, downloads) | Your own files under `plugin.dataDirectory` | Until you delete them | none |

All four are private to the plugin; another plugin never reads them.

## Settings: a JSON file

`storage.json` reads `<dataDirectory>/<name>.json` when you call it and gives you `value` at once (the defaults when the file is missing, broken or fails `validate`; a broken file is kept aside as `<name>.json.bad-<time>`). `save` replaces the value in memory and writes the file 300 ms later, through a temporary file and a rename.

```ts
type Prefs = { step: number; recent: string[] };
const prefs = plugin.storage.json<Prefs>("prefs", {
  defaults: { step: 5, recent: [] },
  // Checked when the file is read: an older version may have written it.
  validate: (v): v is Prefs => typeof (v as Prefs)?.step === "number" && Array.isArray((v as Prefs)?.recent),
});
prefs.save({ ...prefs.value, step: 10 }); // never change prefs.value in place
```

Stopping the plugin writes a pending save first, so a quit right after `save` loses nothing. Call `await prefs.flush()` before you read or copy the file yourself. See [Remember a window's state between runs](window-state.md) for a complete window built on a store.

## Work in progress: session values

`storage.session` keeps JSON values in the player for this run: a reload of the plugin (an upgrade, a crash, the user's Reload) finds them again; the next player start does not.

```ts
const session = plugin.storage.session;
const queue = (await session.get<string[]>("queue")) ?? []; // undefined: nothing stored
queue.push("https://example.com/a.mkv");
try {
  await session.set("queue", queue); // kept once this resolves
} catch (error) {
  // `limit`: the plugin's values would pass 1 MiB; nothing changed.
  if ((error as PluginError).code !== "limit") throw error;
}
```

Each call is one request, answered in order, with no debounce. Keys are 1–1024 bytes; values come back as `JSON.stringify` wrote them (object properties may come back in another order, a `Date` as a string), and are not checked, so check their shape.

## Secrets: the system's store

`plugin.secrets` stores short text values in the macOS keychain or the Windows Credential Manager. Never write a token to a settings file.

```ts
let token = await plugin.secrets.get("api-token").catch(() => null); // no store: ask
if (token === null) {
  token = "…"; // ask the user, for example in a tool window
  await plugin.secrets.set("api-token", token).catch((error: PluginError) => {
    // `unsupported` (no store), `unavailable` or `failed` (access denied).
    void plugin.osd.show("The token is not kept for next time ({})", [error.code]);
  });
}
```

Names are 1–64 of `a-z 0-9 . _ -`, values 1–1024 bytes, at most 256 names. Have a fallback: some systems have no store, and the user can deny access.

## Your own files

For anything larger (a cache, downloaded files), write under `plugin.dataDirectory` with Node's `fs`. The player deletes the directory only when the plugin is uninstalled together with its data (`packages.uninstall` with `removeData`).

## See also

- The API reference: `Storage`, `JsonStore`, `SessionStorage`, `Secrets`; the limits are `SESSION_STORAGE_LIMITS` and `SECRET_LIMITS` in `@vestra-player/sdk/testing`.
- [Test a plugin](testing.md): `startPlugin`'s `dataDirectory` and `sessionStorage` options simulate a restart.
