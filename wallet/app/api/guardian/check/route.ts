export const runtime = "nodejs";

const guardianAgentUrl = () =>
  process.env.NEXT_PUBLIC_GUARDIAN_AGENT_URL ?? "http://localhost:3003";

export async function POST(req: Request) {
  const bodyText = await req.text();
  let upstream: Response;
  try {
    upstream = await fetch(new URL("/check", guardianAgentUrl()), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyText,
    });
  } catch {
    return new Response("guardian service unreachable", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), { status: upstream.status });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
