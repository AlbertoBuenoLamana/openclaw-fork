/**
 * P1 Blueprint Runner — fork patch
 *
 * Executes a CronBlueprintPayload: an ordered list of nodes that alternate
 * between deterministic shell commands and LLM agent turns.
 *
 * Deterministic nodes run first via child_process.exec and inject their
 * output as {{id}} placeholders into subsequent agent messages.
 *
 * Agent nodes call runCronIsolatedAgentTurn with a hydrated message.
 * Each agent node supports maxRetries and onFail: "abort" | "continue".
 *
 * The entire blueprint shares a single session key and agent context.
 */

import { exec as _exec } from "node:child_process";
import { promisify } from "node:util";
import type { CliDeps } from "../../cli/outbound-send-deps.js";
import type { OpenClawConfig } from "../../config/config.js";
import { logWarn } from "../../logger.js";
import type { CronBlueprintPayload, CronJob } from "../types.js";
import { runCronIsolatedAgentTurn } from "./run.js";
import type { RunCronAgentTurnResult } from "./run.js";

const execAsync = promisify(_exec);

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
  /** Accumulated context from deterministic nodes: id → stdout */
  const context: Record<string, string> = {};

  /** Replace all {{id}} placeholders with accumulated context values. */
  const hydrate = (text: string): string => {
    let result = text;
    for (const [id, value] of Object.entries(context)) {
      result = result.replaceAll(`{{${id}}}`, value);
    }
    return result;
  };

  let lastAgentResult: RunCronAgentTurnResult | undefined;

  for (let i = 0; i < payload.nodes.length; i++) {
    const node = payload.nodes[i];
    const nodeLabel = node.label ?? (node.kind === "deterministic" ? node.id : `agent-${i}`);
    const nodeTag = `[blueprint:${jobId}:${i}:${nodeLabel}]`;

    if (node.kind === "deterministic") {
      // ── Deterministic node: run shell command ──────────────────────────
      const timeoutMs = node.timeoutMs ?? 30_000;
      logWarn(`${nodeTag} running deterministic command`);
      try {
        const { stdout, stderr } = await execAsync(node.run, {
          timeout: timeoutMs,
          maxBuffer: 512 * 1024,
        });
        const raw = stdout.trim() || stderr.trim() || "(no output)";
        const preview = raw.length > 120 ? raw.slice(0, 120) + "..." : raw;
        logWarn(`${nodeTag} result: ${preview}`);
        context[node.id] = raw;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logWarn(`${nodeTag} FAILED: ${msg}`);
        if ((node.onFail ?? "abort") === "abort") {
          return {
            status: "error",
            error: `Blueprint node '${nodeLabel}' failed: ${msg}`,
            sessionId: params.sessionKey,
            sessionKey: params.sessionKey,
          };
        }
        // onFail: "continue" — inject empty string and move on
        context[node.id] = "(command failed)";
      }
    } else {
      // ── Agent node: run LLM agent with hydrated message ───────────────
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

        // Build a synthetic job with the hydrated message for this node
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
        return {
          status: "error",
          error: `Blueprint agent node '${nodeLabel}' produced no result`,
          sessionId: params.sessionKey,
          sessionKey: params.sessionKey,
        };
      }

      if (nodeResult.status !== "ok") {
        logWarn(`${nodeTag} agent FAILED after ${attempt} attempt(s): ${nodeResult.error}`);
        if (onFail === "abort") {
          return nodeResult;
        }
        // onFail: "continue" — log and move to next node
        logWarn(`${nodeTag} onFail=continue, proceeding`);
      }

      // Inject agent output as a context variable named "agent_<i>"
      // so subsequent nodes can reference {{agent_0}}, {{agent_1}}, etc.
      if (nodeResult.outputText) {
        context[`agent_${i}`] = nodeResult.outputText;
      }

      lastAgentResult = nodeResult;
    }
  }

  // Return the last agent node result (or ok with no output if blueprint
  // was all deterministic — unusual but valid).
  return (
    lastAgentResult ?? {
      status: "ok",
      sessionId: params.sessionKey,
      sessionKey: params.sessionKey,
    }
  );
}
