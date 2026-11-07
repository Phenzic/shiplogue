export type SectionKey = "yesterday" | "today" | "next" | "blockers";

export type FormatSection = {
  key: SectionKey;
  label: string;
};

// The one built-in format. It is intentionally not user-configurable in the
// extension. Paid workspaces can supply labels/order from the cloud, and those
// are ignored for free plans.
export const BUILTIN_FORMAT: readonly FormatSection[] = Object.freeze([
  { key: "yesterday", label: "Yesterday" },
  { key: "today", label: "Today" },
  { key: "next", label: "Next" },
  { key: "blockers", label: "Blockers" },
]);

const KEYS: SectionKey[] = ["yesterday", "today", "next", "blockers"];

let active: FormatSection[] = BUILTIN_FORMAT.map((section) => ({ ...section }));

/** Built-in unless a paid cloud profile has been applied. */
export function getFormatSections(): FormatSection[] {
  return active;
}

export function resetFormatSections(): void {
  active = BUILTIN_FORMAT.map((section) => ({ ...section }));
}

/** Any plan other than "free" counts as paid for custom-format entitlement. */
export function isPaidPlan(plan: unknown): boolean {
  return typeof plan === "string" && plan.trim().length > 0 && plan.trim().toLowerCase() !== "free";
}

/**
 * Validate a cloud-provided format. Must contain each semantic section exactly
 * once, with a short single-line label. Order is preserved. Invalid profiles
 * fall back to the built-in format rather than breaking generation.
 */
export function normalizeFormatSections(input: unknown): FormatSection[] | undefined {
  if (!Array.isArray(input) || input.length !== KEYS.length) return undefined;

  const seen = new Set<SectionKey>();
  const sections: FormatSection[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return undefined;
    const key = (raw as { key?: unknown }).key;
    const label = (raw as { label?: unknown }).label;
    if (typeof key !== "string" || !KEYS.includes(key as SectionKey)) return undefined;
    if (seen.has(key as SectionKey)) return undefined;
    if (typeof label !== "string") return undefined;

    const cleaned = label
      .replace(/[\r\n]+/g, " ")
      .replace(/\*\*/g, "")
      .trim()
      .slice(0, 40);
    if (!cleaned) return undefined;

    seen.add(key as SectionKey);
    sections.push({ key: key as SectionKey, label: cleaned });
  }

  return seen.size === KEYS.length ? sections : undefined;
}

/** Apply a validated paid profile; anything invalid/absent restores the built-in. */
export function setFormatSections(input: unknown): FormatSection[] {
  const sections = normalizeFormatSections(input);
  active = sections ?? BUILTIN_FORMAT.map((section) => ({ ...section }));
  return active;
}
