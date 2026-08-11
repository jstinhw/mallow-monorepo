import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { OutgoingHttpHeaders } from "node:http";
import {
  analyzeTransactionRequest,
  transactionRequestSchema,
  type AgentHooks,
  type AgentReport,
} from "../agent/agent";
import { redact } from "../tools/contract-storage-tracer/src/redact";

/**
 * The agent entry point, injectable so tests can drive the stream without touching
 * the chain or a model. Production always gets `analyzeTransactionRequest`.
 */
export type AnalyzeFn = (input: unknown, hooks: AgentHooks) => Promise<AgentReport>;

/**
 * `POST /check` runs one guardian analysis and streams it as Server-Sent Events, because a
 * full trace + two LLM turns takes tens of seconds and the caller (the wallet's review screen)
 * shows progress live:
 *   event: progress  {"line"}      — pipeline step: trace, analyzer round, tool call
 *   event: delta     {channel,text} — raw model tokens as they arrive
 *   event: verdict   GuardianVerdict — the terminal event on success
 *   event: error     {"message"}    — the terminal event on failure
 * The stream always ends after a verdict or an error; the HTTP status is 200 either way,
 * since headers are flushed before the agent starts.
 */
export function buildServer(analyze: AnalyzeFn = analyzeTransactionRequest): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // Every log line — ours, and Fastify's own request/error logging — leaves through
      // this stream, so it is the one place that has to redact. A failed RPC call reaches
      // here as a viem error whose message carries the keyed RPC URL verbatim.
      stream: {
        write: (line: string): void => {
          process.stdout.write(redact(line));
        },
      },
    },
  });

  app.register(cors, {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"],
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: "not found" }));

  app.get("/health", async () => ({ ok: true }));

  app.post("/check", async (request, reply) => {
    const parsed = transactionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid request",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      });
    }
    const seed = parsed.data;

    reply.raw.writeHead(200, {
      // Writing to the raw socket skips Fastify's reply, so the CORS headers the
      // plugin set there have to be carried over by hand or the browser blocks the stream.
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event: string, data: unknown): void => {
      if (reply.raw.writableEnded) return;
      // The client can vanish mid-analysis; a dead socket must not kill the run.
      try {
        // Every SSE frame is serialized here, so redacting the finished frame covers
        // progress lines, model deltas, the verdict, and relayed error messages at once.
        reply.raw.write(redact(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      } catch {
        /* client gone */
      }
    };

    request.log.info(
      { chainId: seed.chainId, from: seed.from, to: seed.to },
      "guardian check started",
    );
    // The model server takes one call at a time, so a run nobody is listening to still blocks
    // the next caller for minutes. When the client hangs up, let go of the model turn.
    const aborter = new AbortController();
    reply.raw.on("close", () => aborter.abort());
    try {
      const report = await analyze(seed, {
        onProgress: (line) => send("progress", { line }),
        onDelta: (delta) => send("delta", delta),
        signal: aborter.signal,
      });
      // Emit before logging: a throw from the log call would otherwise turn a
      // completed analysis into an `error` event.
      send("verdict", report.verdict);
      request.log.info(
        {
          risk: report.verdict.risk,
          decision: report.verdict.decision,
          durationMs: report.verdict.meta.durationMs,
        },
        "guardian check completed",
      );
    } catch (error) {
      request.log.error(error, "guardian check failed");
      send("error", { message: error instanceof Error ? error.message : "unknown error" });
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  return app;
}
