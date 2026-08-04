/**
 * Step logger for the trace pipeline. Writes human-readable, numbered progress to a sink
 * (stderr by default) so the machine-readable report can still own stdout. Enable/disable
 * with the `enabled` flag — the engine gates it on `TRACE_LOG !== "0"`.
 */
export interface StepLogger {
  /** A top-level, numbered pipeline step. */
  step(msg: string): void;
  /** An indented sub-step (e.g. one contract in the recursion). */
  sub(msg: string): void;
  /** An indented note under a sub-step (e.g. one function's verdict). */
  note(msg: string): void;
  /** A call-tree line under a note (pre-built `├─`/`└─` connectors, no bullet). */
  tree(msg: string): void;
}

const noop = (): void => {};
export const noopLogger: StepLogger = { step: noop, sub: noop, note: noop, tree: noop };

export function createStepLogger(
  enabled: boolean,
  sink: NodeJS.WritableStream = process.stderr,
): StepLogger {
  if (!enabled) return noopLogger;
  let n = 0;
  const write = (line: string): void => {
    sink.write(`${line}\n`);
  };
  return {
    step(msg) {
      n += 1;
      write(`[trace] ${String(n).padStart(2, " ")}. ${msg}`);
    },
    sub(msg) {
      write(`[trace]       → ${msg}`);
    },
    note(msg) {
      write(`[trace]         · ${msg}`);
    },
    tree(msg) {
      write(`[trace]           ${msg}`);
    },
  };
}
