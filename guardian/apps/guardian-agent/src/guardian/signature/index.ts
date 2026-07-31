import type { GuardianCheck } from "../../protocol";
import type { SignatureAnalysis } from "./classify";

export { classifySignature } from "./classify";
export type { SignatureAnalysis, SignatureKind } from "./classify";

// Turn the deterministic signature classification into the "what Guardian found"
// check row shown alongside the tool-call checks. ok=true means Guardian could
// pin down the exact authorization; ok=false flags an unrecognized or mismatched
// signature the user should scrutinize.
export function signatureCheck(analysis: SignatureAnalysis): GuardianCheck {
  const ok = analysis.kind !== "unknown-typed-data" && !analysis.unlimited;
  return {
    kind: "signature",
    ok,
    title: analysis.title,
    detail: analysis.outcome,
  };
}
