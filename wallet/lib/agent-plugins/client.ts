import type { AgentInstallBody, AgentInstallResponse, AgentRequest } from "@mallow/agents-protocol";
import { parseAgentInstallResponse, parseAgentRequest } from "./protocol-schemas";

export async function fetchAgentRequest(
  serviceUrl: string,
  account: `0x${string}`,
): Promise<AgentRequest> {
  const url = new URL("/request", serviceUrl);
  url.searchParams.set("account", account);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`agent request failed: ${res.status}`);
  return parseAgentRequest(await res.json());
}

export async function postActionResults(
  endpointUrl: string,
  body: AgentInstallBody,
): Promise<void> {
  const res = await fetch(endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`action results failed: ${res.status}`);
}

export async function postAgentInstall(
  serviceUrl: string,
  body: AgentInstallBody,
): Promise<AgentInstallResponse> {
  const res = await fetch(new URL("/install", serviceUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`agent install failed: ${res.status}`);
  return parseAgentInstallResponse(await res.json());
}

export type AgentUninstallResult = {
  kind: string;
  userOpHash?: string | null;
  transferred?: string;
  withdrew?: { aave: string; morpho: string };
  to?: `0x${string}`;
  error?: string;
};

export async function postAgentUninstall(
  serviceUrl: string,
  account: `0x${string}`,
): Promise<AgentUninstallResult> {
  const res = await fetch(new URL("/uninstall", serviceUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account }),
  });
  const body = (await res.json()) as AgentUninstallResult;
  if (!res.ok && body.kind !== "uninstalled") {
    throw new Error(body.error ?? body.kind ?? `agent uninstall failed: ${res.status}`);
  }
  return body;
}

export async function fetchAgentStatus(
  serviceUrl: string,
  account?: string | null,
): Promise<unknown> {
  const url = new URL("/status", serviceUrl);
  url.searchParams.set("mode", "ai");
  if (account) {
    url.searchParams.set("account", account);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`agent status failed: ${res.status}`);
  return res.json();
}

export async function fetchAgentStatusHtml(
  serviceUrl: string,
  account?: string | null,
): Promise<string> {
  const url = new URL("/status", serviceUrl);
  url.searchParams.set("mode", "human");
  if (account) {
    url.searchParams.set("account", account);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`agent status (html) failed: ${res.status}`);
  return res.text();
}
