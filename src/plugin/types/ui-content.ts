// UI category, part 1: what a view shows (props, images, Markdown) and the view itself.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { Json } from "../../wire.ts";
import type { Disposable } from "./base.ts";
import type { Text, TextList } from "./ui-locale.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Plugin, Scope } from "./base.ts";
import type { System } from "./services.ts";
import type { Panel, Window } from "./ui-layout.ts";
import type { SettingsPage } from "./ui-shell.ts";
import type { WireView } from "./plugin-wire.ts";
/* oxlint-enable no-unused-vars */

// ---------------------------------------------------------------- windows and panels

/**
 * An image file for a Slint `image` property, made by {@link Ui.image}.
 *
 * @remarks
 * Opaque: pass it where the Slint type is `image`, with {@link View.set} or
 * {@link View.bind}: the whole value of an `image` property or, from SDK
 * 1.5.19 (player 0.5.1), an `image` field at any depth, such as the logo of
 * each row of a list. Making the reference does not read the file: the
 * player checks and decodes it each time it receives the value (a property
 * write, a window opening; {@link Ui.image} has the rules and limits).
 *
 * A reference belongs to the {@link Scope} that created it. Once that scope
 * is disposed, writing the reference fails with `invalid` (reported to
 * {@link Scope.onError}); an image already on screen stays until the
 * property changes or the view closes.
 *
 * @example Show a cover image from the data directory
 * A window opens showing `cover.png`, which the plugin saved in its data
 * directory. `ui.image` only makes a reference, without reading the file;
 * the player checks and decodes the file when it receives the value, so a
 * missing file fails that write with `missing` (here: `show` rejects, as
 * it is an initial property). A missing image nested inside a value is
 * drawn empty instead.
 * ```ts
 * const cover = plugin.windows.create("ui/cover.slint");
 * // `art` is an `image` property in ui/cover.slint.
 * cover.set({ art: plugin.ui.image(`${plugin.dataDirectory}/cover.png`) });
 * await cover.show();
 * ```
 *
 * @example Show a logo in each row of a list
 * Each row of the list draws its own small logo next to its name. An
 * `ImageRef` may sit in any field of a property value (SDK 1.5.19, player
 * 0.5.1), so the rows carry their icons; `maxSide: 64` decodes each logo
 * at most 64 px wide, which keeps the view's image memory small.
 * ```slint
 * export struct Row { key: string, name: string, icon: image }
 * ```
 * ```ts
 * const items = [{ id: "a", name: "A", iconPath: `${plugin.dataDirectory}/a.png` }];
 * const list = plugin.windows.create("ui/list.slint");
 * list.bind(() => ({
 *   rows: items.map((item) => ({
 *     key: item.id,
 *     name: item.name,
 *     // About twice the drawn size (32 px) stays sharp on dense screens.
 *     icon: plugin.ui.image(item.iconPath, { maxSide: 64 }),
 *   })),
 * }));
 * ```
 *
 * @see {@link Ui.image}, [Windows, panels, settings pages, dialogs and the OSD](../../../docs/explanation/ui.md)
 * @since 1.0.0
 * @category UI
 */
export interface ImageRef {
  /** The path given to {@link Ui.image}, unchanged. */
  readonly path: string;
  /** Brand that marks the value as an image reference; never construct one yourself. */
  readonly __vestraImage: true;
}

/**
 * Options of {@link Ui.image} and {@link Ui.remoteImage}.
 *
 * @since 1.5.19
 * @category UI
 */
export interface ImageOptions {
  /**
   * Decode the image scaled down, aspect kept, so that neither side is over
   * this many pixels (an integer 1–4096); smaller images stay as they are.
   * Use about twice the drawn size (64 for a 32 px logo) so that it stays
   * sharp on high-density screens. It keeps the decoded memory small: a
   * 1024×1024 icon is 4 MB decoded, 16 KB at `maxSide: 64`.
   *
   * @player 0.5.1; older players refuse the reference (`invalid`).
   */
  maxSide?: number;
}

/**
 * A Markdown document for `MarkdownView` or `MarkdownBlocks`, made by
 * {@link Ui.markdown}.
 *
 * @remarks
 * Opaque, like {@link ImageRef}: pass it where the Slint type is
 * `[MarkdownBlock]`: the whole value of such a property (the `blocks` of
 * `MarkdownView` from `@vestra/markdown.slint`) or, from SDK 1.5.4, a
 * `[MarkdownBlock]` field at any depth of a property value, such as the
 * `body` of each row of a chat's message list. It carries the text, the
 * base address and the local copies of its remote images; the player parses
 * and draws it. Writing a document whose text did not change (a new
 * reference for the same text included) costs the player no parsing, and a
 * changed document updates only the blocks that changed. It belongs to the
 * scope that created it: once that scope is disposed, writing it fails with
 * `invalid`, wherever it is in the value.
 *
 * @example Show chat messages, one document per row
 * The chat window shows a formatted assistant message. `ui.markdown`
 * resolves once the document is ready (here without downloading images);
 * the reference goes into the `body` field of a row, whose Slint type is
 * `[MarkdownBlock]`, and the player parses and draws it.
 * ```ts
 * const chat = plugin.windows.create("ui/chat.slint");
 * const body = await plugin.ui.markdown("**Hello**", { remoteImages: false });
 * chat.set({ messages: [{ id: "m1", role: "assistant", body }] });
 * ```
 *
 * @player 0.2.0; nested in a value: the player after 0.4.0
 * @see {@link Ui.markdown}, {@link MarkdownOptions}, {@link PropValue}
 * @since 1.1.0
 * @category UI
 */
export interface MarkdownRef {
  /** The Markdown text, as given to {@link Ui.markdown}. */
  readonly text: string;
  /** Brand that marks the value as a Markdown document; never construct one yourself. */
  readonly __vestraMarkdown: true;
}

/**
 * Options of {@link Ui.markdown}: where relative links and images point, and
 * whether remote images are downloaded.
 *
 * @since 1.1.0
 * @category UI
 */
export interface MarkdownOptions {
  /**
   * What relative links and images resolve against: an `http:` or `https:`
   * address (such as the document's own URL) or an absolute directory.
   * Without it, relative links are reported as written and relative images
   * show their alt text.
   */
  base?: string;
  /**
   * Download `https:` images into the data directory. Off: they show their
   * alt text, and the call makes no network requests.
   *
   * @defaultValue `true`
   */
  remoteImages?: boolean;
}

/**
 * The value of one Slint property: JSON with Markdown documents and images
 * at any depth ({@link PropData}).
 *
 * @remarks
 * JSON becomes Slint values as you would expect: booleans for `bool`,
 * finite numbers for `int` and `float`, strings for `string`, arrays for
 * models (`[T]`), objects for structs. Struct field names are passed
 * unchanged, so write them as the Slint file spells them; a name with `_`
 * is refused (Slint treats `_` and `-` as the same, so use camelCase or
 * kebab-case).
 *
 * A {@link Text} or {@link TextList} goes where the Slint type is `string`,
 * at any depth (SDK 1.5.11, player 0.4.3): the player shows it translated
 * with the plugin's catalog, so a `[string]` model (a ComboBox) can mix
 * words and data. The limits below count it as the string it becomes.
 *
 * A {@link MarkdownRef} goes where the Slint type is `[MarkdownBlock]`: the
 * whole value, or a field at any depth (SDK 1.5.4; older players refuse a
 * nested one). An {@link ImageRef} goes where the Slint type is `image`: the
 * whole value, or a field at any depth (SDK 1.5.19, player 0.5.1; older
 * players refuse a nested one with `invalid`). The images nested in the
 * values of one view (a window, panel or settings page) may show at most
 * 32 MB of decoded pixels together (`IMAGE_LIMITS.viewBytes` in
 * `@vestra-player/sdk/runtime`): a write
 * that would pass it is refused with `limit`; use
 * {@link ImageOptions.maxSide} for small pictures such as logos and
 * thumbnails.
 *
 * Limits per value (`UI_VALUE_LIMITS` in `@vestra-player/sdk/testing`,
 * player 0.6.0; players 0.4.3 to 0.5: 16384 values, 4096 rows, 1 MiB of
 * text): nesting depth 8, 1,048,576 values in total (every array, object,
 * string, number, boolean and null counts, the value itself included; a
 * document or an image is one), 100,000 rows per array, 64 KiB per string
 * or field name and 32 MiB of text in total, field names and the text of
 * its Markdown documents included (256 KB per document). A list of rows
 * with 13 fields is 14 values per row, so 50,000 such rows fit. An array
 * property larger than one 1 MiB request is sent in parts (SDK 1.5.46, a
 * player that takes row patches); only the top-level array is split, so
 * any other value, and each row, must fit in one request (a row of more
 * than 512 KiB is refused with `limit`). A value over a limit is refused
 * with code
 * `limit` and the property keeps what it showed (see {@link View.set});
 * `TestHost` refuses it the same way.
 *
 * Bind a whole list and draw it with a Slint `ListView`, which builds only
 * the rows on screen; the SDK sends what changed (row patches).
 *
 * @since 1.0.0
 * @category UI
 */
export type PropValue = PropData | ImageRef;

/**
 * JSON whose values may also be Markdown documents and (SDK 1.5.19) images,
 * at any depth: the part of {@link PropValue} that nests.
 *
 * @example Type a message list whose rows carry a document
 * A property value for a chat's message list, typed so that TypeScript
 * accepts a Markdown document inside each row. `PropData` is the JSON a
 * property takes plus documents and images at any depth; the player turns
 * each object into a Slint struct by its field names.
 * ```ts
 * const messages: PropData = [
 *   { id: "m1", role: "user", body: await plugin.ui.markdown("Hi") },
 * ];
 * ```
 *
 * @since 1.5.4
 * @category UI
 */
export type PropData =
  | null
  | boolean
  | number
  | string
  | MarkdownRef
  | ImageRef
  | Text
  | TextList
  | PropData[]
  | { [key: string]: PropData };

/**
 * Properties to write to a view, by name.
 *
 * @remarks
 * Names may be camelCase: the SDK turns every capital letter into `-` plus
 * the lower-case letter (`canMark` → `can-mark`); names already in
 * kebab-case are kept. Only the property names are converted, not the
 * fields of struct values.
 *
 * @example Prepare a window's initial properties
 * An object of property values by name, as `windows.create` and
 * `View.set` take them. Names match the Slint file (`canMark` for
 * `can-mark`), and each value becomes the Slint type of its property: a
 * boolean, and an array of structs for a model.
 * ```ts
 * const props: Props = { canMark: true, rows: [{ rowId: "a", title: "First" }] };
 * ```
 *
 * @since 1.0.0
 * @category UI
 */
export type Props = Record<string, PropValue>;

/**
 * Values for Slint properties that are not plain JSON: images from files and
 * Markdown documents. `plugin.ui`.
 *
 * @remarks
 * A Slint file can only name images compiled into it (`@image-url`). To show
 * an image the plugin picks at run time (cover art, a thumbnail it rendered,
 * a downloaded icon), make an {@link ImageRef} with {@link Ui.image} and
 * write it to an `image` property. To show formatted text, make a
 * {@link MarkdownRef} with {@link Ui.markdown} and give it to `MarkdownView`.
 * Both work in tool windows, panels (the backdrop and the floating sidebar
 * included) and settings pages.
 *
 * @capability None.
 *
 * @example Show a Markdown file in a window (examples/markdown)
 * A menu item opens a window with a formatted Markdown file that ships
 * with the plugin. The plugin reads the file, turns it into a document
 * with `ui.markdown` (relative images resolve against the plugin's
 * directory through `base`) and writes it to the window's `doc` property,
 * which the Slint file hands to `MarkdownView`.
 *
 * {@includeCode ../../../examples/markdown/main.ts#document}
 *
 * `ui/document.slint`:
 *
 * {@includeCode ../../../examples/markdown/ui/document.slint}
 *
 * @see {@link ImageRef}, {@link MarkdownRef}, [Windows, panels, settings pages, dialogs and the OSD](../../../docs/explanation/ui.md)
 * @since 1.0.0
 * @category UI
 */
export interface Ui {
  /**
   * Reference a PNG or JPEG file for an `image` property.
   *
   * @remarks
   * Returns at once without touching the file. The player checks the file
   * each time it receives the reference (a property write, a window or
   * settings page opening, the main window being rebuilt): it must be inside this plugin's package
   * directory or {@link Plugin.dataDirectory} after following links, at most
   * 16 MB and 4096×4096 pixels, and PNG or JPEG by content (the extension
   * does not matter). A failed check of a whole-value image is a failed
   * property write: `missing` for a file that does not exist, `invalid`
   * otherwise. It goes to {@link Scope.onError} and the property keeps its
   * previous image; in the initial properties of a tool window it makes
   * {@link Window.show} reject. A nested image (a field of a row, SDK
   * 1.5.19) that fails its check is drawn empty instead, and the rest of
   * the value is shown, as a Markdown image shows its alt text.
   *
   * The player caches decoded images per plugin (up to 64 MB, least recently
   * used first) by path, size and modification time, and does not watch
   * files. After rewriting a file under the same path, call `image()` again
   * and write the new reference: the SDK does not send a value that did not
   * change, so the player would not look at the file again.
   *
   * @capability None.
   *
   * @param path - Absolute path of the image file, inside the package
   *   directory or the data directory.
   * @param options - `maxSide` (SDK 1.5.19, player 0.5.1): decode the image
   *   scaled down, aspect kept, so that neither side is over it.
   * @returns A new {@link ImageRef}, owned by this scope.
   *
   * @throws `invalid` (throws) `path` is not a non-empty string, or
   *   `maxSide` is not an integer 1–4096.
   *
   * @example Show a thumbnail the plugin rendered
   * A window shows a PNG the plugin wrote into its data directory. The file
   * must be inside the package or data directory; `image` returns at once.
   * The player decodes the file when it receives the value and notices a
   * rewritten file by its size and modification time; the plugin still
   * calls `image()` again after rewriting it, because the SDK does not send
   * a value that did not change.
   * ```ts
   * const thumbnailWindow = plugin.windows.create("ui/thumbnail.slint");
   * const file = `${plugin.dataDirectory}/thumbnail.png`;
   * // … write the PNG to `file` (for example with plugin.tools.run("ffmpeg", …)) …
   * thumbnailWindow.set({ thumbnail: plugin.ui.image(file) });
   * await thumbnailWindow.show();
   * ```
   *
   * @since 1.0.0
   */
  image(path: string, options?: ImageOptions): ImageRef;
  /**
   * Download an `https:` PNG or JPEG image (a thumbnail, a repository's
   * plugin icon) and reference the local copy, as {@link Ui.image} does.
   *
   * @remarks
   * Downloads like {@link Ui.markdown}'s remote images: Node's `fetch` in
   * this plugin's process, at most 4 MB and 10 s per image, 4 downloads at a
   * time per plugin, into `<dataDirectory>/.vestra-cache/images/`; the cache
   * keeps 32 MB and fetches an address again after 24 hours, so a list that
   * shows the same thumbnails again reads them from disk.
   *
   * @capability None (the plugin process has network access).
   * @player Any (the reference is an ordinary {@link ImageRef}); nested in a
   *   value, player 0.5.1.
   *
   * @param url - The image's `https:` address.
   * @param options - As for {@link Ui.image}.
   * @returns The reference, owned by this scope, once the file is in the
   *   cache.
   *
   * @throws `invalid` (rejects) `url` is not an `https:` address, or
   *   `maxSide` is not an integer 1–4096.
   * @throws `unavailable` (rejects) the download failed, timed out, was too
   *   large, or is not a PNG or JPEG image; or the plugin has no data
   *   directory.
   *
   * @example Show search results with downloaded thumbnails
   * A results window lists each hit with its thumbnail, or a placeholder
   * when a thumbnail cannot be fetched. `remoteImage` downloads the image
   * in the plugin's process into the data directory's cache (at most 4 at a
   * time) and resolves with a local reference; a failed download rejects
   * with `unavailable`, which the `catch` turns into the placeholder.
   * ```ts
   * const results = [{ title: "A", thumbnailUrl: "https://example.com/a.jpg" }];
   * const placeholder = plugin.ui.image(`${plugin.dataDirectory}/blank.png`);
   * const rows = await Promise.all(
   *   results.map(async (r) => ({
   *     title: r.title,
   *     thumb: await plugin.ui
   *       .remoteImage(r.thumbnailUrl, { maxSide: 320 })
   *       .catch(() => placeholder), // `unavailable`: download failed
   *   })),
   * );
   * plugin.windows.create("ui/results.slint").set({ rows });
   * ```
   *
   * @since 1.5.19
   */
  remoteImage(url: string, options?: ImageOptions): Promise<ImageRef>;
  /**
   * Prepare a Markdown document for `MarkdownView` (`@vestra/markdown.slint`).
   *
   * @remarks
   * The player renders headings, paragraphs (bold, italic, strikethrough,
   * inline code, links), lists and task lists, code blocks, block quotes,
   * images, tables and rules; embedded HTML is not shown. A click on a link
   * calls the view's `link-clicked(url)` callback with the address resolved
   * against `base`; opening it is up to the plugin (for example with
   * {@link System.openUrl}).
   *
   * Images: PNG or JPEG. Local ones follow {@link Ui.image}'s rules (this
   * plugin's package or data directory). `https:` images are downloaded by
   * this call into `<dataDirectory>/.vestra-cache/markdown/` (each at most
   * 4 MB and 10 s, at most 64 per document; the cache keeps 32 MB and fetches
   * an address again after 24 hours). A failed or unsupported image (SVG,
   * GIF, `http:`…) shows its alt text; the call itself does not fail for it.
   *
   * The text is at most 256 KB; very long documents are cut off after 4000
   * blocks.
   *
   * `MarkdownView` scrolls one document. `MarkdownBlocks` (SDK 1.5.4, players
   * after 0.4.0) draws one without scrolling, as tall as its content, for a
   * layout of your own or a `ListView` row. For a list of documents, write
   * the whole list with one document per row: the player parses only the
   * documents that changed and updates the list in place (rows added or
   * removed at the end, a growing document's changed blocks), so re-sending
   * the list on every streamed chunk keeps the scroll position and costs
   * little.
   *
   * From player 0.7.1 both views take `selectable: true` (default `false`):
   * the user can select and copy the text, one block at a time; blocks with
   * links keep their clickable links and copy as `text (url)`. Code blocks
   * are always selectable. `MarkdownBlock.plain` (the block as plain text)
   * and `MarkdownBlock.links` (its link addresses) are readable in Slint.
   * See [Reference: theme › Markdown](../../../docs/reference/theme.md#markdown).
   *
   * @capability None.
   * @player 0.2.0 (set `"minPlayerVersion": "0.2.0"` in the manifest)
   *
   * @param text - The Markdown source (CommonMark with GitHub tables, task
   *   lists and strikethrough), at most 256 KB as UTF-8.
   * @param options - Where relative addresses point and whether to download
   *   remote images.
   * @returns The document, owned by this scope, once its remote images are
   *   downloaded (or have failed).
   *
   * @throws `invalid` (rejects) `text` is not a string or is over 256 KB, or
   *   `base` is neither an `http(s):` address nor an absolute path.
   * @throws `unsupported` (rejects) The player is older than 0.2.0.
   *
   * @example Build a chat with one Markdown document per row
   * A chat window lists messages as formatted text, with a Copy button on
   * each code block that puts the code on the clipboard. Each row's `body`
   * is a document from `ui.markdown`; the whole list is written again on
   * each change, and the player parses only the documents that changed.
   * `MarkdownBlocks` with `code-copy` calls `copy-code`, which the plugin
   * handles with `on("copyCode")`.
   *
   * `ui/chat.slint`:
   *
   * ```slint
   * import { ListView } from "std-widgets.slint";
   * import { MarkdownBlocks, MarkdownBlock } from "@vestra/markdown.slint";
   * export struct Message { id: string, role: string, body: [MarkdownBlock] }
   * export component Chat inherits Window {
   *     in property <[Message]> messages;
   *     callback copy-code(string);
   *     ListView {
   *         for message in root.messages: VerticalLayout {
   *             padding: 8px;
   *             MarkdownBlocks {
   *                 blocks: message.body;
   *                 code-copy: true;
   *                 copy-code(code) => { root.copy-code(code); }
   *             }
   *         }
   *     }
   * }
   * ```
   *
   * ```ts
   * const chat = plugin.windows.create("ui/chat.slint");
   * const history: { id: string; role: string; text: string }[] = [];
   * chat.on("copyCode", (code: string) => plugin.clipboard.writeText(code));
   * // Re-send the whole list: unchanged documents cost the player nothing.
   * async function render() {
   *   const messages = [];
   *   for (const { id, role, text } of history)
   *     messages.push({ id, role, body: await plugin.ui.markdown(text) });
   *   chat.set({ messages });
   * }
   * history.push({ id: "1", role: "user", text: "Show me `ls`." });
   * await render();
   * await chat.show();
   * ```
   *
   * @example Show a README from the web
   * A window shows a README downloaded from the web, its images included,
   * and clicked links open in the browser. `base` makes relative links and
   * images resolve against the README's address; `markdown` resolves after
   * its `https:` images are downloaded. A click on a link makes
   * `MarkdownView` call `link-clicked`, which `ui/readme.slint` forwards as
   * `open-link`; the plugin opens the address with `openUrl`.
   * ```ts
   * const readmeUrl = "https://example.com/plugin/README.md";
   * const response = await fetch(readmeUrl);
   * if (!response.ok) throw new Error(`README: HTTP ${response.status}`);
   * const text = await response.text();
   * const readmeWindow = plugin.windows.create("ui/readme.slint");
   * // Bound before the first `show`, as a tool window requires.
   * readmeWindow.on("openLink", (url: string) => plugin.system.openUrl(url));
   * readmeWindow.set({ doc: await plugin.ui.markdown(text, { base: readmeUrl }) });
   * await readmeWindow.show();
   * ```
   *
   * @since 1.1.0
   */
  markdown(text: string, options?: MarkdownOptions): Promise<MarkdownRef>;
}

/**
 * The surface that tool windows, panels and settings pages share: properties
 * out to Slint, callbacks in from Slint.
 *
 * @remarks
 * The plugin's TypeScript and its Slint files run in different processes and
 * exchange two kinds of messages. Plugin → UI: `in` and `in-out` properties,
 * written with {@link View.set} or kept up to date with {@link View.bind}.
 * UI → plugin: Slint callbacks (returning nothing), handled with
 * {@link View.on}. A {@link Window} declares them on its exported component;
 * a {@link Panel} and a {@link SettingsPage} declare them on the file's
 * exported global, the bridge. The plugin cannot call Slint functions or read
 * a property back: a value the user changes reaches it only through a
 * callback.
 *
 * `bind` is the usual way: the SDK re-evaluates bound functions in every
 * full update pass (after each handler it calls, on {@link Scope.update}),
 * and after a player state change those that read a changed field of
 * `plugin.player.state`, and sends only what changed, at most one write in
 * flight per view. `set` sends now, even an unchanged value.
 *
 * Writes that fail (a name the Slint file does not declare, a value of the
 * wrong type, an image that fails its check): a bound value is not sent
 * again until it changes; a `set` value is retried with back-off (0.25 s,
 * doubling up to 30 s); the first failure of a series is reported to
 * {@link Scope.onError}.
 *
 * A control whose value both the user and the plugin change needs a two-way
 * binding to an `in-out` property (`value <=> root.level`). A one-way
 * binding (`value: root.level`) is broken by Slint the first time the user
 * moves the control.
 *
 * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
 *
 * @example Wire a window's label and buttons to the plugin (examples/bookmark)
 * A Bookmark window shows the saved position and two buttons that save
 * it and jump back to it. `bind` keeps the label and the buttons' enabled
 * state equal to the plugin's state: the SDK evaluates the function again
 * after every handler and player change and sends only what changed. The
 * buttons' Slint callbacks reach the plugin through `on`.
 *
 * {@includeCode ../../../examples/bookmark/main.ts#window}
 *
 * `ui/bookmark.slint`:
 *
 * {@includeCode ../../../examples/bookmark/ui/bookmark.slint}
 *
 * @see {@link Window}, {@link Panel}, {@link SettingsPage}, [Windows, panels, settings pages, dialogs and the OSD](../../../docs/explanation/ui.md), [Keep a slider responsive while dragging](../../../docs/how-to/slider.md)
 * @since 1.0.0
 * @category UI
 */
export interface View {
  /**
   * Handle a Slint callback.
   *
   * @remarks
   * The handler receives the callback's arguments as JSON (struct fields
   * spelled as in Slint). It may be async. An error it throws, or a rejection
   * of its promise, goes to {@link Scope.onError}. After it returns, and
   * again when its promise settles, the SDK runs an update pass, so state it
   * changed reaches bound properties without further calls (state changed
   * after an `await` appears only when the promise settles; call
   * {@link Scope.update} to show it earlier).
   *
   * Calling `on` again with the same name replaces the handler. A callback
   * the plugin has no handler for is ignored.
   *
   * **Tool windows** forward only the callback names bound when the window
   * opens: bind every name before the first {@link Window.show}. While the
   * window is open, binding a new name throws; after a close the next `show`
   * registers the names bound by then. A name the Slint file does not declare
   * makes `show` reject. **Panels and settings pages** forward every
   * callback of their bridge global, so bind whenever you like.
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param callback - The Slint callback's name, in camelCase
   *   (`toggleEffect`) or as written in Slint (`toggle-effect`).
   * @param handler - Receives the callback's arguments.
   * @returns A handle that removes this handler (if it is still the current
   *   one for the name).
   *
   * @throws `Error` without a code (throws) On an open {@link Window}, for a
   *   name that has no handler yet.
   *
   * @example Keep a slider and the plugin's value in step
   * Moving the window's brightness slider updates the plugin's value, and
   * the slider shows it back. The Slint callback `brightness-changed`
   * reaches the handler with the slider's value as JSON; after the handler
   * returns, the SDK runs an update pass and `bind` sends the new value.
   * Callbacks of a tool window must be bound before its first `show`.
   * ```ts
   * const picture = plugin.windows.create("ui/picture.slint");
   * let brightness = 0;
   * // camelCase here, `brightness-changed` in the Slint file.
   * picture.on("brightnessChanged", (value: number) => {
   *   brightness = value;
   * });
   * picture.bind(() => ({ brightness }));
   * await picture.show();
   * ```
   *
   * @since 1.0.0
   */
  on<A extends Json[]>(
    callback: string,
    handler: (...args: A) => unknown,
  ): Disposable;
  /**
   * Write properties now, even values that did not change.
   *
   * @remarks
   * Each value given is sent once with the next write, even if it equals the
   * last value sent. That makes `set` the way to pull a control back to the
   * model value after the user moved it, or to put a one-off value (a
   * document, an image) on screen. While the view is not open (a window
   * before `show`, a panel before `ready`) the values are kept and become its
   * initial properties.
   *
   * Do not `set` a property that a {@link View.bind} function also returns:
   * the next update pass replaces the set value with the bound one.
   *
   * On a view nothing was bound to, `set` alone writes (SDK 1.7.0): each
   * value is sent whole, a large list in parts, one write in flight per
   * view; the SDK neither compares nor turns lists into row patches, and
   * the view takes no part in update passes. From the view's first
   * {@link View.bind} on, `set` values go the bound way: a list that
   * differs from the one sent is sent as a row patch where one applies.
   *
   * A property the plugin writes directly ({@link WireView.write}, SDK
   * 1.7.0) cannot be `set`: one track per property. Otherwise it never
   * throws. A write that fails is retried with back-off and reported
   * to {@link Scope.onError} (the first failure of a run of failures; the
   * message names the property). A value over the limits of
   * {@link PropValue} fails with `limit`. As an initial property (written
   * while the view is not open) it makes {@link Window.show} reject; a
   * panel or settings page still opens without it (the property keeps its
   * default) and the failure goes to the plugin's `onError` (player 0.4.3;
   * older players left it out silently).
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param props - Properties by name; see {@link Props}.
   *
   * @throws `invalid` (throws) A property of `props` is written directly
   *   with {@link WireView.write} ("property `rows` is written directly;
   *   bind it or write it, not both"); nothing of `props` is kept.
   *
   * @example Put a drop-down back when the user picks an entry the plugin refuses
   * Choosing "Custom" snaps the drop-down back to the last real preset.
   * The plugin cannot read a property back, only hear the callback; `set`
   * sends the value even though it equals the one sent before, which is
   * what pulls a control the user moved back to the plugin's value.
   * ```ts
   * const presetsWindow = plugin.windows.create("ui/presets.slint");
   * let presetIndex = 0;
   * presetsWindow.on("presetChosen", (index: number) => {
   *   if (index > 2) presetsWindow.set({ presetIndex }); // "Custom" is not a preset
   *   else presetIndex = index;
   * });
   * ```
   *
   * @since 1.0.0
   */
  set(props: Props): void;
  /**
   * Keep properties equal to a function of the plugin's state.
   *
   * @remarks
   * The SDK calls `props` in every update pass (and right after `bind`) and
   * sends the values that differ from the ones it sent last; a view takes
   * part in the update passes from its first `bind` on (SDK 1.7.0). After a
   * change of the player state alone it calls `props` only if it read a
   * field of `plugin.player.state` (or of a {@link Scope.state} object) that
   * changed (SDK 1.5.45); a full pass follows
   * after each handler, on {@link Scope.update} and at least once a second
   * while the player state keeps changing. Because an
   * unchanged value is not sent again, text the user typed into an `in-out`
   * property stays until the plugin's value for it changes.
   *
   * Keep the function quick and synchronous: it runs often. An error it
   * throws is reported to {@link Scope.onError} and the other bindings still
   * run. A view can have several bindings; when two return the same name,
   * the one bound later wins.
   *
   * Never throws. Writes that fail are not repeated until the value
   * changes, and are reported to {@link Scope.onError} like a failed
   * {@link View.set} (a value over the limits of {@link PropValue}: `limit`).
   * A property the plugin writes directly ({@link WireView.write}, SDK
   * 1.7.0) is left out of what the function returns, reported once to
   * `onError` with `invalid`: one track per property.
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param props - Returns the properties, by name.
   * @returns A handle that stops this binding (the values last sent stay).
   *
   * @example Show what is playing and whether it can seek
   * The status window always shows the current file and enables its seek
   * controls only for seekable sources. The SDK calls the function right
   * away, again in every full update pass (after each handler) and after
   * each change of `source` or `can`, and sends only the values that
   * changed.
   * ```ts
   * const status = plugin.windows.create("ui/status.slint");
   * status.bind(() => ({
   *   title: plugin.player.state.source ?? "Nothing playing",
   *   canSeek: plugin.player.state.can.seek,
   * }));
   * ```
   *
   * @see [Keep a slider responsive while dragging](../../../docs/how-to/slider.md)
   * @since 1.0.0
   */
  bind(props: () => Props): Disposable;
}
