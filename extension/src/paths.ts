// Path helpers shared by tracker/gather/cursor. Activity is matched across
// process boundaries (VS Code events, Cursor's SQLite file:// URIs, stored
// logs), so paths are always compared "/"-normalized, and case-insensitively
// on Windows where the filesystem is case-insensitive.
export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

// Canonical form for workspace-folder comparisons: forward slashes, no
// trailing slash, lower-cased on win32.
export function normalizeFolderPath(p: string): string {
  const n = normalizeSlashes(p).replace(/\/+$/, "");
  return process.platform === "win32" ? n.toLowerCase() : n;
}
