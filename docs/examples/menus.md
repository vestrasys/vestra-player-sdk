---
title: "Example: Menus"
---

# Example: Menus

What a menu item can look like: radio items, separator groups, a greyed-out item, and an item whose title changes. The items set the playback speed.

## What you'll build

![Menus in Vestra Player](../../examples/menus/screenshot.png)

An **Examples** menu in the main menu:

```text
Examples ▸  ○ 0.5×
            ● 1×
            ○ 1.5×
            ○ 2×
            ──────────
            Speed: 1×      (greyed out)
```

Picking a speed changes the playback speed, moves the radio dot and changes the last item's title.

## Files

```text
examples/menus/
  manifest.json          identity and capabilities
  main.ts                the code
  tests/menus.test.ts    tests against the SDK's in-memory player
  package.json           the SDK as a dev dependency, and the scripts
```

## The manifest

{@includeCode ../../examples/menus/manifest.json}

`commands` for the menu items; `playback.read` and `events` to read the current speed and keep it up to date; `playback.control` to change it.

## The code

### Setup

{@includeCode ../../examples/menus/main.ts#setup}

`player` is `plugin.player`, kept in a constant because the code reads it several times.

### An item whose title changes

{@includeCode ../../examples/menus/main.ts#title}

A command's title and path cannot change after it is added. To change them, remove the command and add it again; a child scope makes that easy.

- `status` is a child scope from {@link "@vestra-player/sdk"!Scope.scope | plugin.scope()}. Everything added through it belongs to it.
- `showSpeed` disposes the old scope, which removes the old item from the menu, then makes a new scope and adds the item with the new title.
- `order: 860` puts it after the speeds; `group: "status"` differs from the speeds' group, so the player draws a separator line between them.
- `enabled: false` greys it out: it only shows information. `run` is still required.
- The last line adds the first version, with the current speed.

### Radio items

{@includeCode ../../examples/menus/main.ts#radio}

- The loop adds one command per speed. `entries()` gives the index for `order`, so the items appear in that order (850 to 853).
- All four share the menu path's first segment, `"Examples"`, so they land in the same submenu; the submenu itself sits where its first item sits.
- `group: "speeds"` keeps them in one block.
- `radio: true` draws `checked` as a dot instead of a check mark. Which item is checked is the plugin's decision: `checked` compares the player's current speed with this item's. The SDK re-evaluates it whenever the player's state changes, so the dot also moves when the speed changes in some other way.
- `enabled` greys the items out while the video cannot change speed, for example with nothing open.
- `run` changes the speed with {@link "@vestra-player/sdk"!Player.setRate | player.setRate}, then rebuilds the status item.

## The tests

{@includeCode ../../examples/menus/tests/menus.test.ts}

- `host.openElsewhere` opens a file, so the speed can change.
- `host.command(id).declaration` is the command as declared (`radio`, `group`, `path`); `state` is what the player shows now (`checked`, `enabled`).
- After `rate-1.5` runs, the `speed` command has been declared again with the new title.

## Run it

```sh
npm ci                    # once, in the SDK repository root
cd examples/menus
npm install
npm run check && npm test
npm run pack              # examples.menus-0.1.0.vxp
```

Start the player with `--plugin <path to examples/menus>`, open a video and pick a speed from **Examples**.

## Try next

1. **Keep the title in step** when the speed changes elsewhere: call `showSpeed` from `plugin.player.onChange` when `state.rate` differs from the last value shown.
2. **A check item.** Add a command with `checked: () => player.state.paused` (no `radio`) that toggles pause.
3. **A repeating key.** Give a command `bindings: ["Ctrl+Alt+ArrowUp"]` and `repeat: true`: it runs again while the key is held, which suits small steps such as volume.
