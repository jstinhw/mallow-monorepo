import { buildServer } from "./app";

const PORT = Number(process.env.PORT ?? 3002);

const app = buildServer();

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`guardian agent service listening on http://localhost:${PORT}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
