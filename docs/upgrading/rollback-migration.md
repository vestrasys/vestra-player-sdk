---
title: Migrating off package rollback (1.5.16, removed in 1.5.17)
description: What to change in a plugin manager now that the player keeps no previous plugin version. Packages.rollback and PluginInfo.previousVersion were deprecated in SDK 1.5.16 and removed in 1.5.17.
---

# Migrating off package rollback (1.5.16, removed in 1.5.17)

For plugins that manage other plugins (`plugins.manage`): stores, plugin managers, anything that called `packages.rollback` or read `PluginInfo.previousVersion`. Both were deprecated in 1.5.16 and **removed in 1.5.17**: with 1.5.17 a remaining use is a TypeScript compile error. A plugin that only uses its own API needs no change.

## What changed

The player no longer keeps a previous version of a plugin. An upgrade replaces the package, so there is nothing to roll back to:

- There is no `packages.rollback`: the player answers the wire method with `unsupported` ("unknown package method"), and SDK 1.5.17 no longer has it.
- `packages.list()` and `packages.onChange` entries have no `previousVersion` (always `null` with SDK 1.5.16, removed in 1.5.17).
- Built-in plugins (`builtin: true`) run in place from the player installation. Users manage only third-party plugins: a built-in can be neither uninstalled, replaced nor (from SDK 1.5.18 and the players released with it) disabled; `uninstall` and `setEnabled(id, false)` fail with `unsupported`, and a built-in an older player let the user disable runs again after the upgrade. A built-in's `directory` is inside the installation (`<install resources>/plugins/<id>`) and read-only.
- Third-party plugins can still be uninstalled.

Why: built-ins now run from the read-only installation instead of a copy, and an upgrade replaces the package instead of keeping the old one beside it. Going back to an older version becomes an ordinary uninstall and install that the user starts.

`TestHost` behaves the same way, so tests show it too.

## 1. Remove rollback calls and `previousVersion` checks

Before:

```ts nocheck
if (info.previousVersion !== null)
  showButton("Roll back", () => plugin.packages.rollback(info.id));
```

After: delete both. There is no replacement call; nothing on the player can restore an earlier package. Remove the button, menu item or command, and any state, text or test that depends on `previousVersion`. With SDK 1.5.17 the compiler finds every remaining use.

## 2. Going back to an older version

Managing third-party plugins has exactly three operations: **install**, **uninstall** and **disable/enable**. Built-ins have none of them. There is no rollback, no "install older version" and no "Undo install".

To go back to an older version, the user uninstalls the plugin and installs the older version's `.vxp` file themselves, as two ordinary operations. Do not offer an action that does both, an older-version install from a store, or an "Undo" after an install (the official store and the AI window drop theirs). Uninstalling without `removeData` keeps the plugin's data, and a reinstall from the same source reconnects to it; a `.vxp` file is a different source from a repository, so a plugin first installed from the store gets a new, empty data directory.

## 3. Remove "Undo install"

Remove any Undo action after an install, its texts and translations, and the code that only served it: copies of installed `.vxp` files, remembered "last install" state, and tests of it. A user who wants a plugin gone uninstalls it.

## 4. Built-in plugins

Check `builtin` before offering actions:

```ts
for (const info of await plugin.packages.list()) {
  const actions = info.builtin
    ? []
    : [info.state === "disabled" ? "Enable" : "Disable", "Uninstall"];
  console.log(info.id, actions);
}
```

- Offer no action for a built-in: never disable, uninstall or install over it (the player answers `unsupported`). Built-ins that an older player listed as `disabled` come back as running.
- Never write into a built-in's `directory`, or into any plugin's `directory`: read `manifest.json` from it if you need to. A plugin writes only under its own {@link "@vestra-player/sdk"!Plugin.dataDirectory | plugin.dataDirectory}.

## 5. Tests

With SDK 1.5.17, `host.packages` entries have no `previousVersion` field: delete `previousVersion: null` (or any value) from test data, or the test no longer compiles. `TestHost` has no `packages.rollback`. Remove tests that exercised a rollback; there is nothing left to assert. (With 1.5.16 the field was still required but ignored, and `TestHost` answered rollback with `unsupported`.)

## Timeline

| SDK    | Player        | What happens                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.5.16 | ships with it | `Packages.rollback` and `PluginInfo.previousVersion` (and the wire field) are `@deprecated`. The player and `TestHost` answer rollback with `unsupported` and list `previousVersion: null`. Code still compiles.                                                                                                              |
| 1.5.17 | ships with it | **Removed:** `Packages.rollback`, `PluginInfo.previousVersion`, the wire method `packages.rollback` and the wire field `previousVersion`, `TestHost`'s `previousVersion` field and its `packages.rollback` handler, and `Packages.rollback` in the `plugins.manage` capability. Remaining uses are TypeScript compile errors. |
| 1.5.18 | ships with it | Built-ins can no longer be disabled: the player and `TestHost` answer `setEnabled(builtin, false)` with `unsupported` (user ruling 2026-10-26).                                                                                                                                                                               |

`apiVersion` stays `vestra/1` in both releases, as when 1.5.8 removed `PackageCandidate.trial()`.

## Before you hand it in

- [ ] No call to `packages.rollback`; no UI or logic gated on `previousVersion`.
- [ ] Built-ins offer no Disable, Enable or Uninstall.
- [ ] Nothing writes into a plugin's `directory`.
- [ ] No Undo after an install, no older-version install; older versions go through uninstall and a user-chosen `.vxp`.
- [ ] Tests compile and pass with SDK 1.5.17; no `previousVersion` is left in `host.packages` test data.
