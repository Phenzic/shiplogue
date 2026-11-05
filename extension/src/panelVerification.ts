import type { Verification } from "./grounding";

// The compact verification summary the panel renders (claim counts + the
// list of violations as "kind: text" strings). Grounding returns a richer
// object with the cleaned draft; this is its display projection.
export interface PanelVerification {
  checkedClaims: number;
  removed: number;
  inferred: number;
  violations: string[];
  needsReview: boolean;
}

export function toPanelVerification(v: Verification): PanelVerification {
  const inferred = (v.cleanDraft?.match(/\*\(inferred\)\*/g) ?? []).length;
  return {
    checkedClaims: v.checkedClaims,
    removed: v.removed.length,
    inferred,
    violations: v.violations.map((x) => `${x.kind}: ${x.text}`),
    needsReview: v.needsReview,
  };
}
