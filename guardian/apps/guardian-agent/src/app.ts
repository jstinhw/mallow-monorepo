import cors from "@fastify/cors";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { checkRoute } from "./endpoints/check";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: { level: "info" } });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(cors, {
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"],
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: "validation failed",
        issues: error.validation,
      });
    }
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(error);
    }
    const message = statusCode < 500 ? error.message || "request failed" : "internal error";
    return reply.status(statusCode).send({ error: message });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({ error: "not found" });
  });

  app.register(checkRoute);

  return app;
}
