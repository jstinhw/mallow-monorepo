import { spawn } from "node:child_process";

export class CastError extends Error {
  constructor(
    public cmd: string,
    public code: number | null,
    public stderr: string,
  ) {
    super(`${cmd} exited with code ${code}: ${stderr.slice(0, 400)}`);
  }
}

export type RunOpts = { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv };

export async function runCmd(cmd: string, args: string[], opts: RunOpts = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(stdout);
      else reject(new CastError(`${cmd} ${args.join(" ")}`, code, stderr));
    });
  });
}
