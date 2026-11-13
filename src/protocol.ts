/** The plugin API version this SDK implements (`manifest.apiVersion`). */
export const API_VERSION = "vestra/1";

/**
 * The longest message a plugin may send the player, in UTF-8 bytes of one
 * protocol line with its newline (1 MiB). The player stops a plugin that
 * writes a longer one, so the plugin's side refuses such a request before
 * sending it: it rejects with code `limit`. Property values meet
 * {@link UI_VALUE_LIMITS} before this.
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export const MESSAGE_LIMIT = 1024 * 1024;
