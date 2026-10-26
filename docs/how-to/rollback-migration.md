---
title: Migrating off package rollback (1.5.16)
description: What to change in a plugin manager now that the player keeps no previous plugin version, before SDK 1.5.17 removes Packages.rollback and PluginInfo.previousVersion.
---

# Migrating off package rollback (1.5.16)

For plugins that manage other plugins (`plugins.manage`): stores, plugin managers, anything that calls {@link "@vestra-player/sdk"!Packages.rollback | packages.rollback} or reads {@link "@vestra-player/sdk"!PluginInfo.previousVersion | PluginInfo.previousVersion}. A plugin that only uses its own API needs no change.

## What changed

The player no longer keeps a previous version of a plugin. An upgrade replaces the package, so there is nothing to roll back to:

- `packages.rollback(id)` always fails with `unsupported` (the player answers "unknown package method").
- Every entry of `packages.list()` and `packages.onChange` has `previousVersion: null`.
- Built-in plugins (`builtin: true`) run in place from the player installation. They can be disabled and enabled, never uninstalled or replaced; `uninstall` fails with `unsupported`. A built-in's `directory` is inside the installation (`<install resources>/plugins/<id>`) and read-only.
- Third-party plugins can still be uninstalled.

Why: built-ins now run from the read-only installation instead of a copy, and an upgrade replaces the package instead of keeping the old one beside it. Going back to an older version becomes an ordinary uninstall and install that the user starts.

`TestHost` behaves the same way since 1.5.16, so tests show it too.

## 1. Remove rollback calls and `previousVersion` checks

Before:

```ts nocheck
if (info.previousVersion !== null) showButton("Roll back", () => plugin.packages.rollback(info.id));
```

After: delete both. There is no replacement call; nothing on the player can restore an earlier package. Remove the button, menu item or command, and any state, text or test that depends on `previousVersion`.

## 2. Going back to an older version

Managing plugins has exactly three operations: **install**, **uninstall** and **disable/enable**. There is no rollback, no "install older version" and no "Undo install".

To go back to an older version, the user uninstalls the plugin and installs the older version's `.vxp` file themselves, as two ordinary operations. Do not offer an action that does both, an older-version install from a store, or an "Undo" after an install (the official store and the AI window drop theirs). Uninstalling without `removeData` keeps the plugin's data, and a reinstall from the same source reconnects to it; a `.vxp` file is a different source from a repository, so a plugin first installed from the store gets a new, empty data directory.

## 3. Remove "Undo install"

Remove any Undo action after an install, its texts and translations, and the code that only served it: copies of installed `.vxp` files, remembered "last install" state, and tests of it. A user who wants a plugin gone uninstalls it.

## 4. Built-in plugins

Check `builtin` before offering actions:

```ts
for (const info of await plugin.packages.list()) {
  const actions = info.builtin
    ? [info.state === "disabled" ? "Enable" : "Disable"]
    : ["Disable", "Uninstall"];
  console.log(info.id, actions);
}
```

- Offer only disable and enable for a built-in (`packages.setEnabled`); never uninstall or install over it.
- Never write into a built-in's `directory`, or into any plugin's `directory`: read `manifest.json` from it if you need to. A plugin writes only under its own {@link "@vestra-player/sdk"!Plugin.dataDirectory | plugin.dataDirectory}.

## 5. Tests

`TestHost` lists every plugin with `previousVersion: null`, whatever a test puts in `host.packages`, and rejects `packages.rollback` with `unsupported`. The `previousVersion` field of `host.packages` entries is deprecated and ignored; it stays required in 1.5.16 so that test data shaped like a `PluginInfo` keeps compiling, and goes in 1.5.17. A test that expected a rollback to succeed should now assert the rejection or be removed.

## Timeline

| SDK | Player | What happens |
| --- | --- | --- |
| 1.5.16 | ships with it | `Packages.rollback` and `PluginInfo.previousVersion` (and the wire field) are `@deprecated`. The player and `TestHost` answer rollback with `unsupported` and list `previousVersion: null`. Code still compiles. |
| 1.5.17 | — | Both symbols are removed. Remaining uses are TypeScript compile errors. |

`apiVersion` stays `vestra/1` in both releases, as when 1.5.8 removed `PackageCandidate.trial()`.

## Before you hand it in

- [ ] No call to `packages.rollback`; no UI or logic gated on `previousVersion`.
- [ ] Built-ins offer only disable and enable.
- [ ] Nothing writes into a plugin's `directory`.
- [ ] No Undo after an install, no older-version install; older versions go through uninstall and a user-chosen `.vxp`.
- [ ] Tests pass with SDK 1.5.16; the only deprecated name left in them is the `previousVersion: null` of `host.packages` test data.
