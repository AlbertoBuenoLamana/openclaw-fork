/**
 * P1 Blueprint Runner — fork patch (v2)
 *
 * Executes a CronBlueprintPayload: an ordered list of nodes that alternate
 * between deterministic shell commands and LLM agent turns.
 *
 * Features:
 * - Deterministic nodes: run shell commands, capture stdout → inject via
 *   {{id}} placeholders into subsequent messages.
 * - Agent nodes: run the LLM with a hydrated message. Support maxRetries
 *   and onFail: "abort" | "continue".
 * - condition: skip a node unless a named prior node failed
 *   (e.g. condition: "lint.failed" → only run if node "lint" had exitCode != 0).
 * - storeAs: store deterministic output under a custom context key in addition
 *   to the node's id.
 * - onAbort: send a Telegram (or other channel) notification when a blueprint
 *   aborts, including which node failed and the error message.
 */

import { exec as _exec } from "node:child_process";
import { promisify } from "node:util";
import type { CliDeps } from "../../cli/outbound-send-deps.js";
import type { OpenClawConfig } from "../../config/config.js";
import { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import { logWarn } from "../../logger.js";
import type { CronBlueprintPayload, CronJob } from "../types.js";
import { runCronIsolatedAgentTurn } from "./run.js";
import type { RunCronAgentTurnResult } from "./run.js";

const execAsync = promisify(_exec);

/**
 * Per-node execution state tracked internally.
 * Used to evaluate `condition` expressions on subsequent nodes.
 */
type NodeState = {
  /** true if the node ran and succeeded */
  ok: boolean;
  /** true if the node ran and failed (exit code != 0 or exception) */
  failed: boolean;
  /** true if the node was skipped due to condition not met */
  skipped: boolean;
  /** raw stdout/stderr output (deterministic) or outputText (agent) */
  output: string;
};

/**
 * Evaluate a condition expression against accumulated node states.
 * Supported expressions: "<nodeId>.failed", "<nodeId>.ok", "<nodeId>.skipped"
 * Returns true if the node should run, false if it should be skipped.
 * Unknown expressions → always run (fail open for forward compat).
 */
function evalCondition(condition: string, nodeStates: Record<string, NodeState>): boolean {
  const match = condition.trim().match(/^(\w[\w-]*)\.(\w+)$/);
  if (!match) {
    logWarn(`[blueprint] Unknown condition expression: "${condition}" — defaulting to run`);
    return true;
  }
  const [, nodeId, prop] = match;
  const state = nodeStates[nodeId];
  if (!state) {
    logWarn(`[blueprint] Condition references unknown node "${nodeId}" — defaulting to run`);
    return true;
  }
  if (prop === "failed") {
    return state.failed;
  }
  if (prop === "ok") {
    return state.ok;
  }
  if (prop === "skipped") {
    return state.skipped;
  }
  logWarn(
    `[blueprint] Unknown condition property "${prop}" for node "${nodeId}" — defaulting to run`,
  );
  return true;
}

/**
 * Send an abort notification via the configured channel (best-effort).
 * Mirrors the failureAlert mechanism but with a blueprint-specific message.
 */
async function sendAbortNotification(params: {
  cfg: OpenClawConfig;
  job: CronJob;
  payload: CronBlueprintPayload;
  abortedNode: string;
  error: string;
}): Promise<void> {
  const { cfg, job, payload, abortedNode, error } = params;
  if (!payload.onAbort) {
    return;
  }

  const channel = payload.onAbort.channel ?? job.delivery?.channel ?? "telegram";
  const to = payload.onAbort.to ?? job.delivery?.to;
  if (!to || channel === "last") {
    logWarn(`[blueprint:${job.id}] onAbort: no delivery target configured, skipping notify`);
    return;
  }

  const jobName = job.name ?? job.id;
  const rawMsg =
    payload.onAbort.message ??
    `Blueprint "${jobName}" abortó en el nodo {{aborted_node}}.\n\nError: {{error}}`;
  const text = rawMsg
    .replaceAll("{{aborted_node}}", abortedNode)
    .replaceAll("{{error}}", error.slice(0, 400))
    .replaceAll("{{job_name}}", jobName)
    .replaceAll("{{job_id}}", job.id);

  try {
    const resolvedChannel = (channel === "last" ? "telegram" : channel) as Exclude<
      import("../../channels/plugins/types.js").ChannelId,
      "none"
    >;
    await deliverOutboundPayloads({
      cfg,
      channel: resolvedChannel,
      to,
      accountId: payload.onAbort.accountId,
      payloads: [{ text }],
      bestEffort: true,
    });
    logWarn(`[blueprint:${job.id}] onAbort notification sent to ${channel}:${to}`);
  } catch (err) {
    logWarn(`[blueprint:${job.id}] onAbort notification failed: ${String(err)}`);
  }
}

/**
 * Execute a blueprint payload: ordered list of deterministic + agent nodes.
 */
export async function runCronBlueprint(params: {
  cfg: OpenClawConfig;
  deps: CliDeps;
  job: CronJob;
  payload: CronBlueprintPayload;
  sessionKey: string;
  agentId?: string;
  lane?: string;
  abortSignal?: AbortSignal;
}): Promise<RunCronAgentTurnResult> {
  const { job, payload } = params;
  const jobId = job.id;

  /** Accumulated context: id/storeAs → stdout (for {{placeholder}} hydration) */
  const context: Record<string, string> = {};

  /** Per-node execution state (for condition evaluation) */
  const nodeStates: Record<string, NodeState> = {};

  /** Replace all {{id}} placeholders with accumulated context values. */
  const hydrate = (text: string): string => {
    let result = text;
    for (const [id, value] of Object.entries(context)) {
      result = result.replaceAll(`{{${id}}}`, value);
    }
    return result;
  };

  /** Abort: notify + return error result */
  const abort = async (abortedNode: string, error: string): Promise<RunCronAgentTurnResult> => {
    logWarn(`[blueprint:${jobId}] ABORT at node "${abortedNode}": ${error}`);
    await sendAbortNotification({
      cfg: params.cfg,
      job,
      payload,
      abortedNode,
      error,
    });
    return {
      status: "error",
      error: `Blueprint aborted at node "${abortedNode}": ${error}`,
      sessionId: params.sessionKey,
      sessionKey: params.sessionKey,
    };
  };

  let lastAgentResult: RunCronAgentTurnResult | undefined;

  for (let i = 0; i < payload.nodes.length; i++) {
    const node = payload.nodes[i];
    const nodeLabel = node.label ?? (node.kind === "deterministic" ? node.id : `agent-${i}`);
    const nodeTag = `[blueprint:${jobId}:${i}:${nodeLabel}]`;

    // ── condition check ───────────────────────────────────────────────────
    if (node.condition) {
      const shouldRun = evalCondition(node.condition, nodeStates);
      if (!shouldRun) {
        logWarn(`${nodeTag} SKIPPED (condition "${node.condition}" not met)`);
        nodeStates[nodeLabel] = { ok: false, failed: false, skipped: true, output: "" };
        // Also key by id for deterministic nodes
        if (node.kind === "deterministic") {
          nodeStates[node.id] = nodeStates[nodeLabel];
          context[node.id] = "(skipped)";
          if (node.storeAs) {
            context[node.storeAs] = "(skipped)";
          }
        }
        continue;
      }
    }

    if (node.kind === "deterministic") {
      // ── Deterministic node ────────────────────────────────────────────
      const timeoutMs = node.timeoutMs ?? 30_000;
      logWarn(`${nodeTag} running: ${node.run.slice(0, 80)}`);

      let raw = "";
      let nodeFailed = false;

      try {
        const { stdout, stderr } = await execAsync(node.run, {
          timeout: timeoutMs,
          maxBuffer: 512 * 1024,
        });
        raw = stdout.trim() || stderr.trim() || "(no output)";
        const preview = raw.length > 120 ? raw.slice(0, 120) + "..." : raw;
        logWarn(`${nodeTag} ok: ${preview}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        nodeFailed = true;
        raw = `(command failed: ${msg})`;
        logWarn(`${nodeTag} FAILED: ${msg}`);

        nodeStates[node.id] = { ok: false, failed: true, skipped: false, output: raw };
        nodeStates[nodeLabel] = nodeStates[node.id];

        if ((node.onFail ?? "abort") === "abort") {
          return await abort(nodeLabel, msg);
        }
        // onFail: "continue" — store failure output and proceed
      }

      // Store output under id and optional storeAs alias
      context[node.id] = raw;
      if (node.storeAs) {
        context[node.storeAs] = raw;
      }

      if (!nodeFailed) {
        nodeStates[node.id] = { ok: true, failed: false, skipped: false, output: raw };
        nodeStates[nodeLabel] = nodeStates[node.id];
      }
    } else {
      // ── Agent node ────────────────────────────────────────────────────
      const hydratedMessage = hydrate(node.message);
      const maxRetries = node.maxRetries ?? 0;
      const onFail = node.onFail ?? "abort";

      let attempt = 0;
      let nodeResult: RunCronAgentTurnResult | undefined;

      while (attempt <= maxRetries) {
        if (attempt > 0) {
          logWarn(`${nodeTag} retry ${attempt}/${maxRetries}`);
        } else {
          logWarn(`${nodeTag} running agent node`);
        }

        const syntheticJob: CronJob = {
          ...job,
          payload: {
            kind: "agentTurn",
            message: hydratedMessage,
            model: payload.model,
            fallbacks: payload.fallbacks,
            timeoutSeconds: node.timeoutSeconds ?? payload.timeoutSeconds,
          },
        };

        nodeResult = await runCronIsolatedAgentTurn({
          cfg: params.cfg,
          deps: params.deps,
          job: syntheticJob,
          message: hydratedMessage,
          sessionKey: params.sessionKey,
          agentId: params.agentId,
          lane: params.lane,
          abortSignal: params.abortSignal,
        });

        if (nodeResult.status === "ok") {
          break;
        }
        attempt++;
      }

      if (!nodeResult) {
        return await abort(nodeLabel, "agent node produced no result");
      }

      const agentOutput = nodeResult.outputText ?? "";

      if (nodeResult.status !== "ok") {
        logWarn(`${nodeTag} agent FAILED after ${attempt} attempt(s): ${nodeResult.error}`);
        nodeStates[nodeLabel] = { ok: false, failed: true, skipped: false, output: agentOutput };

        if (onFail === "abort") {
          return await abort(nodeLabel, nodeResult.error ?? "agent failed");
        }
        logWarn(`${nodeTag} onFail=continue, proceeding`);
      } else {
        nodeStates[nodeLabel] = { ok: true, failed: false, skipped: false, output: agentOutput };
      }

      // Inject agent output as {{agent_N}} and also under node label for conditions
      if (agentOutput) {
        context[`agent_${i}`] = agentOutput;
        context[nodeLabel] = agentOutput;
        if (node.storeAs) {
          context[node.storeAs] = agentOutput;
        }
      }

      lastAgentResult = nodeResult;
    }
  }

  return (
    lastAgentResult ?? {
      status: "ok",
      sessionId: params.sessionKey,
      sessionKey: params.sessionKey,
    }
  );
}
