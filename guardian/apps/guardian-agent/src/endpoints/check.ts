import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Address, Hex } from "viem";
import type { GuardianInput, ProgressEvent } from "../protocol";
import { etherscanKey, llmConfig, rpcUrlForChain } from "../config";
import { runGuardian } from "../guardian/check";
import { checkBodySchema } from "../schemas";

export async function checkRoute(app: FastifyInstance) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .post("/check", { schema: { body: checkBodySchema } }, async (request, reply) => {
      const body = request.body;
      const rpcUrl = rpcUrlForChain(body.chainId);
      if (!rpcUrl) {
        request.log.warn({ chainId: body.chainId }, "check request rejected: chain not configured");
        return reply.status(400).send({ error: `chain ${body.chainId} not configured` });
      }

      const input: GuardianInput = {
        chainId: body.chainId,
        from: body.from as Address,
        to: body.to as Address,
        value: BigInt(body.value),
        data: body.data as Hex,
        ...(body.typedData ? { typedData: body.typedData } : {}),
      };
      const cfg = { rpcUrl, etherscanKey: etherscanKey(), llm: llmConfig() };

      request.log.info(
        {
          chainId: input.chainId,
          from: input.from,
          to: input.to,
          value: input.value.toString(),
          dataLength: input.data.length,
          isSignature: !!input.typedData,
        },
        "Starting guardian transaction safety check",
      );

      reply.raw.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const send = (event: string, payload: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      try {
        const verdict = await runGuardian({
          input,
          cfg,
          onProgress: (e: ProgressEvent) => {
            request.log.info({ stage: e.stage }, `Guardian stage: ${e.stage}`);
            send("progress", e);
          },
        });
        request.log.info(
          {
            verdict: {
              risk: verdict.risk,
              durationMs: verdict.meta?.durationMs,
              findingsCount: verdict.findings?.length,
            },
          },
          "Guardian transaction safety check completed",
        );
        send("verdict", verdict);
      } catch (err) {
        request.log.error(err, "Guardian transaction safety check failed with error");
        send("error", { message: err instanceof Error ? err.message : "unknown error" });
      } finally {
        reply.raw.end();
      }
      return reply;
    });
}
