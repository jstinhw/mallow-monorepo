import "dotenv/config";
import { buildServer } from "./app";

const app = buildServer();

app.listen({ port: Number(process.env.PORT ?? 3002), host: "0.0.0.0" }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
