/** Stage D candidate; additive discovery capability, not the shared release baseline. */
import type { Transport } from "./wire.ts";
export type SourceStamp = {
  generation: number;
  intentVersion: number;
};
export type SourceTicket = {
  stamp: SourceStamp;
  cycle: number;
  owner: number;
};
export type SourceIntent =
  | {
      kind: "openProvider";
      producerId: number;
      startPaused: boolean;
      expected?: SourceStamp;
    }
  | {
      kind: "open";
      source: string;
      startPaused: boolean;
      expected?: SourceStamp;
    }
  | { kind: "restart" | "close"; expected?: SourceStamp }
  | {
      kind: "control";
      control:
        | { kind: "pause"; paused: boolean }
        | { kind: "seek"; seconds: number }
        | { kind: "rate"; rate: number };
      expected?: SourceStamp;
    };
export type SourceAudioTrack = {
  trackId: number;
  streamIndex: number | null;
  selected: boolean;
  external: boolean;
  codec: string | null;
  title: string | null;
  language: string | null;
};
export interface SourceState {
  kind: "media" | "producer";
  container: string | null;
  snapshotProfile?: {
    timeDomain: "mpv-media";
    fileOriginValidation: "deferred-worker-origin-match-required";
  };
  audioTracks: SourceAudioTrack[] | null;
  controlPending?: boolean;
  audioHealth?: {
    status: import("./producer.ts").ProducerState["health"];
    deviceErrors: number;
    xrunEvents: number;
    deviceChangeEvents: number;
    errorDetails: string[];
    errorOverflow: number;
    buffer: import("./producer.ts").ProducerState["buffer"];
  } | null;
  stamp: SourceStamp;
  cycle: number;
  eventSequence: number;
  phase: "empty" | "loading" | "ready" | "ended" | "error";
  source: string | null;
  loadingOwner: number | null;
  terminalReason:
    "natural" | "stopped" | "replaced" | "unknown" | { failed: string } | null;
  paused: boolean;
  position: number | null;
  /** Backend metadata estimate; sample availability and clip video coverage are validated by worker. */
  duration: number | null;
  capabilities: {
    pause: boolean;
    seek: boolean;
    rate: boolean;
    restart: boolean;
    close: boolean;
    snapshotSource: boolean;
  };
  output: { volume: number; muted: boolean };
  rate: number;
}
export type SourceOperation =
  | { status: "pending" | "completed"; ticket: SourceTicket }
  | {
      status: "failed";
      error:
        | "stale"
        | "invalid"
        | "noSource"
        | "conflict"
        | "busy"
        | "unknownExpired"
        | { backend: string };
    };
export function sourceClient(transport: Transport) {
  let next = 0;
  return {
    state: () => transport.request<SourceState>("source.state"),
    submit: (intent: SourceIntent, operationId?: number) => {
      operationId ??= next + 1;
      if (!Number.isSafeInteger(operationId) || operationId <= 0) {
        return Promise.reject(
          Object.assign(
            new TypeError("operationId must be a positive safe integer"),
            { code: "invalid" },
          ),
        );
      }
      next = Math.max(next, operationId);
      return transport.request<SourceOperation>("source.submit", {
        operationId,
        intent,
      });
    },
    operation: (operationId: number) =>
      transport.request<SourceOperation>("source.operation", { operationId }),
  };
}
