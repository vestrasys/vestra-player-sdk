/**
 * The private state of a `TestHost` (`./index.ts`): what the class keeps
 * out of its public members. The host holds one in its private `#inner`
 * field and passes it to the area modules' functions, so it is reachable
 * only from inside the SDK.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Json } from "../../wire.ts";
import type { SourceStamp } from "../../source.ts";
import type { Locale } from "../types.ts";
import { Catalog } from "../../i18n.ts";
import type { TestHost } from "./index.ts";

/** A wire method's default or overriding handler (as `TestHost.handle` takes it). */
export type Handler = Parameters<TestHost["handle"]>[1];

/** The private state of one `TestHost`. */
export class Internals {
  locale: Locale | undefined;
  /** The plugin's translations for `locale` (see `loadCatalog`). */
  catalog: Catalog = new Catalog();
  /**
   * Row patches: the `seq` of each property's last write, by view and property
   * (none: 0, the initial properties).
   */
  readonly writes = new Map<string, number>();
  /** The parts of a whole value held until its last part, by view and property. */
  readonly parts = new Map<string, { seq: number; rows: Json[] }>();
  /** The exported global each mounted panel's properties belong to, by slot. */
  readonly globals = new Map<string, string | undefined>();
  /**
   * A panel's properties (view and name) whose stored initial value the
   * panel could not take: it shows the property's default.
   */
  readonly unshown = new Set<string>();
  nextOwner = 2;
  /** Owners of other plugins' panels, by plugin id ({@link TestHost.mountOther}). */
  readonly others = new Map<string, { slot: string; owner: number }>();
  /** What each job was asked to write, for its outcome. */
  readonly exportJobs = new Map<
    number,
    {
      destination: string;
      clip: {
        start: number;
        end: number;
        container: "mp4" | "mkv" | null;
      } | null;
      /** An export of parts (`jobs.start { parts }`): its part count, length and container. */
      join?: {
        parts: number;
        total: number;
        container: "mp4" | "mkv";
        written: { start: number; end: number }[];
        mode: "copy" | "mp4";
      };
    }
  >();
  sentTypes = "[]";
  readonly overrides = new Map<string, Handler>();
  readonly listeners = new Map<string, Set<(data: unknown) => void>>();
  inFlight = 0;
  /** `disconnect()` of `startPlugin`: the player is gone. */
  lost = false;
  lose: (error: Error) => void = () => {};
  /** Rejects when the player is lost: requests in flight fail with it. */
  readonly gone = (() => {
    const gone = new Promise<never>((_, reject) => {
      this.lose = reject;
    });
    gone.catch(() => {});
    return gone;
  })();
  next = { snapshot: 0, job: 0, producer: 0, source: 0, resolution: 0 };
  sourceBook = new Map<number, Json>();
  /** The pending resolutions' stamps and operations (beside `resolutions`). */
  resolving = new Map<number, { stamp: SourceStamp; operation?: number }>();
  /** The producer the source is (`openProvider`, a resolved stream). */
  selected: number | null = null;
  readonly scratch = mkdtempSync(join(tmpdir(), "vestra-test-host-"));
  /** The labels `commands.keys` last answered or pushed, as JSON. */
  keysSent = "";
  /** The binding table revision of `commands.keys` (a counter here). */
  keysRevision = 0;
  /**
   * Like the player (2026-11-09): a seek from the end plays on unless the
   * end was reached while paused or by a frame step (set when the phase
   * becomes `ended`).
   */
  endKeepsPause = false;
  /** A frame step since the last source intent (the player's `stepped`). */
  stepped = false;
  /** The next source intent is a frame step back from the end: it stays paused. */
  holdPause = false;
  /**
   * The resources this plugin loaded into the current source (resource id →
   * bytes), removed ones included: like the player, a removed track frees
   * its place among the live tracks but not among the loads.
   */
  subtitleResources = { generation: -1, bytes: new Map<string, number>() };
}
