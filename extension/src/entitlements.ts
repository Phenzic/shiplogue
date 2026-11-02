// Entitlements gate for Pro features. MOCK until the Pro backend exists
// (Plan 2 §7 P2 / Plan 3 A1): every Pro feature is granted locally. Replace
// this with a real entitlement check against the Standup Draft cloud API — the
// call sites (auto-post, hosted generation) are already behind this seam.
export type ProFeature = "autoPost";

export async function isProFeatureEnabled(_feature: ProFeature): Promise<boolean> {
  return true; // mock: everyone is Pro until billing lands
}
