import type { ChannelId } from "../channels/plugins/types.js";
import type { CronJobBase } from "./types-shared.js";

export type CronSchedule =
  | { kind: "at"; at: string }
  | { kind: "every"; everyMs: number; anchorMs?: number }
  | {
      kind: "cron";
      expr: string;
      tz?: string;
      /** Optional deterministic stagger window in milliseconds (0 keeps exact schedule). */
      staggerMs?: number;
    };

export type CronSessionTarget = "main" | "isolated";
export type CronWakeMode = "next-heartbeat" | "now";

export type CronMessageChannel = ChannelId | "last";

export type CronDeliveryMode = "none" | "announce" | "webhook";

export type CronDelivery = {
  mode: CronDeliveryMode;
  channel?: CronMessageChannel;
  to?: string;
  /** Explicit channel account id for multi-account setups (e.g. multiple Telegram bots). */
  accountId?: string;
  bestEffort?: boolean;
  /** Separate destination for failure notifications. */
  failureDestination?: CronFailureDestination;
};

export type CronFailureDestination = {
  channel?: CronMessageChannel;
  to?: string;
  accountId?: string;
  mode?: "announce" | "webhook";
};

export type CronDeliveryPatch = Partial<CronDelivery>;

export type CronRunStatus = "ok" | "error" | "skipped";
export type CronDeliveryStatus = "delivered" | "not-delivered" | "unknown" | "not-requested";

export type CronUsageSummary = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
};

export type CronRunTelemetry = {
  model?: string;
  provider?: string;
  usage?: CronUsageSummary;
};

export type CronRunOutcome = {
  status: CronRunStatus;
  error?: string;
  /** Optional classifier for execution errors to guide fallback behavior. */
  errorKind?: "delivery-target";
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
};

export type CronFailureAlert = {
  after?: number;
  channel?: CronMessageChannel;
  to?: string;
  cooldownMs?: number;
  /** Delivery mode: announce (via messaging channels) or webhook (HTTP POST). */
  mode?: "announce" | "webhook";
  /** Account ID for multi-account channel configurations. */
  accountId?: string;
};

// ── P1 Blueprint types ──────────────────────────────────────────────────────

/**
 * A single node in a blueprint. Nodes are executed in order.
 *
 * - kind "deterministic": run a shell command, capture stdout → injects
 *   result as {{id}} placeholder in subsequent node messages.
 * - kind "agent": run the LLM agent with the given message (may use
 *   {{id}} placeholders from prior deterministic nodes).
 */
export type BlueprintNode =
  | {
      kind: "deterministic";
      /** Identifier for {{id}} placeholder injection into later messages. */
      id: string;
      /** Shell command to execute. */
      run: string;
      /** Human-readable label for logs. */
      label?: string;
      /** Timeout in ms (default: 30 000). */
      timeoutMs?: number;
      /** What to do if this command fails: abort run or continue. Default: "abort". */
      onFail?: "abort" | "continue";
    }
  | {
      kind: "agent";
      /** Message sent to the LLM (may reference {{id}} from prior nodes). */
      message: string;
      /** Human-readable label for logs. */
      label?: string;
      /** Max retries if agent run fails (default: 0). */
      maxRetries?: number;
      /** What to do if the agent run still fails after retries. Default: "abort". */
      onFail?: "abort" | "continue";
      /** Timeout override in seconds for this agent node. */
      timeoutSeconds?: number;
    };

export type CronBlueprintPayload = {
  kind: "blueprint";
  nodes: BlueprintNode[];
  /** Optional model override applied to all agent nodes. */
  model?: string;
  /** Optional fallback models applied to all agent nodes. */
  fallbacks?: string[];
  /** Per-blueprint timeout for the entire run in seconds. */
  timeoutSeconds?: number;
};

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | CronAgentTurnPayload
  | CronBlueprintPayload;

export type CronPayloadPatch =
  | { kind: "systemEvent"; text?: string }
  | CronAgentTurnPayloadPatch
  | CronBlueprintPayload;

type CronAgentTurnPayloadFields = {
  message: string;
  /** Optional model override (provider/model or alias). */
  model?: string;
  /** Optional per-job fallback models; overrides agent/global fallbacks when defined. */
  fallbacks?: string[];
  thinking?: string;
  timeoutSeconds?: number;
  allowUnsafeExternalContent?: boolean;
  /** If true, run with lightweight bootstrap context. */
  lightContext?: boolean;
  deliver?: boolean;
  channel?: CronMessageChannel;
  to?: string;
  bestEffortDeliver?: boolean;
  /** Commands to run deterministically before the agent loop.
   * Each command stdout is captured and injected into the message
   * by replacing {{id}} placeholders. Errors abort the run before
   * spending any LLM tokens. (fork patch: P3 pre-hydration)
   */
  preContext?: Array<{
    /** Identifier used as {{id}} placeholder in the message. */
    id: string;
    /** Shell command to execute. */
    run: string;
    /** Human-readable label shown in logs. */
    label?: string;
    /** Timeout in milliseconds for this command (default: 30000). */
    timeoutMs?: number;
  }>;
};

type CronAgentTurnPayload = {
  kind: "agentTurn";
} & CronAgentTurnPayloadFields;

type CronAgentTurnPayloadPatch = {
  kind: "agentTurn";
} & Partial<CronAgentTurnPayloadFields>;

export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  /** Preferred execution outcome field. */
  lastRunStatus?: CronRunStatus;
  /** Back-compat alias for lastRunStatus. */
  lastStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  /** Number of consecutive execution errors (reset on success). Used for backoff. */
  consecutiveErrors?: number;
  /** Last failure alert timestamp (ms since epoch) for cooldown gating. */
  lastFailureAlertAtMs?: number;
  /** Number of consecutive schedule computation errors. Auto-disables job after threshold. */
  scheduleErrorCount?: number;
  /** Explicit delivery outcome, separate from execution outcome. */
  lastDeliveryStatus?: CronDeliveryStatus;
  /** Delivery-specific error text when available. */
  lastDeliveryError?: string;
  /** Whether the last run's output was delivered to the target channel. */
  lastDelivered?: boolean;
};

export type CronJob = CronJobBase<
  CronSchedule,
  CronSessionTarget,
  CronWakeMode,
  CronPayload,
  CronDelivery,
  CronFailureAlert | false
> & {
  state: CronJobState;
};

export type CronStoreFile = {
  version: 1;
  jobs: CronJob[];
};

export type CronJobCreate = Omit<CronJob, "id" | "createdAtMs" | "updatedAtMs" | "state"> & {
  state?: Partial<CronJobState>;
};

export type CronJobPatch = Partial<Omit<CronJob, "id" | "createdAtMs" | "state" | "payload">> & {
  payload?: CronPayloadPatch;
  delivery?: CronDeliveryPatch;
  state?: Partial<CronJobState>;
};
