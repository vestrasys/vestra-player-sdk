// 仅用于 Slint 实验；本版本接口与最终成品 API 会有很大差异。
import { assertSerializable } from "./validation.ts";
import type { PlaybackState, PluginContext, UiProperties } from "./types.ts";

type ActionHandler = (value: number) => void | Promise<void>;
type PlaybackHandler = (state: PlaybackState) => void | Promise<void>;
export type Request = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export function createContext(transport: Request) {
  const request: Request = (method, params) => {
    try {
      assertSerializable(params);
    } catch (error) {
      return Promise.reject(error);
    }
    return transport(method, params);
  };
  const actions = new Map<string, Set<ActionHandler>>();
  const playback = new Set<PlaybackHandler>();
  const input = new Set<
    (event: { key: string; pressed: boolean }) => void | Promise<void>
  >();
  const context: PluginContext = {
    capabilities: () => request<string[]>("capabilities", {}),
    effects: {
      set: (effect) => request<void>("effects.set", { ...effect }),
      remove: (key) => request<void>("effects.remove", { key }),
      list: () => request("effects.list", {}),
      snapshot: (options = {}) => request("effects.snapshot", { ...options }),
      releaseSnapshot: (id) => request("effects.releaseSnapshot", { id }),
    },
    media: {
      start: (task) => request("media.start", { ...task }),
      status: (id) => request("media.status", { id }),
      cancel: (id) => request("media.cancel", { id }),
    },
    sources: {
      setPaused: (options) => request("sources.setPaused", { ...options }),
      open: (options) => request("sources.open", { ...options }),
      present: (frame) => request("sources.present", { ...frame }),
      close: (key) => request("sources.close", { key }),
    },
    plugins: {
      validate: (manifest) => request("plugins.validate", { manifest }),
      install: (manifest) => request("plugins.install", { manifest }),
      remove: (id) => request("plugins.remove", { id }),
    },
    onInput(handler) {
      input.add(handler);
      return () => {
        input.delete(handler);
      };
    },
    onAction(name, handler) {
      const handlers = actions.get(name) ?? new Set<ActionHandler>();
      actions.set(name, handlers);
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    onPlayback(handler) {
      playback.add(handler);
      return () => {
        playback.delete(handler);
      };
    },
    ui: {
      patch: (properties: UiProperties) =>
        request<void>("ui.patch", { properties }),
    },
    dialogs: {
      openMedia: () => request<string | null>("dialogs.openMedia", {}),
      openFile: (options) =>
        request<string | null>("dialogs.openFile", { ...options }),
      saveFile: (options) =>
        request<string | null>("dialogs.saveFile", { ...options }),
    },
    player: {
      load: (path) => request<void>("player.load", { path }),
      togglePause: () => request<void>("player.togglePause", {}),
      seek: (seconds) => request<void>("player.seek", { seconds }),
      snapshot: () => request<PlaybackState>("player.snapshot", {}),
      filters: {
        setGaussian: (options) =>
          request<void>("player.filters.setGaussian", options),
      },
    },
  };
  return {
    context,
    async action(name: string, value: number) {
      if (!Number.isFinite(value)) throw new Error("无效的界面事件参数");
      for (const handler of actions.get(name) ?? []) await handler(value);
    },
    async playback(state: PlaybackState) {
      for (const handler of playback) await handler(state);
    },
    async input(event: { key: string; pressed: boolean }) {
      for (const handler of input) await handler(event);
    },
    clear() {
      actions.clear();
      playback.clear();
      input.clear();
    },
  };
}
