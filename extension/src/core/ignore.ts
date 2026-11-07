import * as fs from "fs";
import * as path from "path";

// Private-path protection. The extension only ever records file *paths*, never
// file contents, but a path can still reveal that a secret file exists. This
// module is the single policy used by the tracker (live saves/edits), the git
// collector (commit file lists) and the activity store (defense in depth).
//
// Two layers:
//   1. Always-private names/dirs (.env, keys, credential stores, .ssh, ...)
//      cannot be re-included by any ignore file.
//   2. Any file matched by a `.gitignore` or a `.*ignore` file in the
//      workspace is skipped, including nested ignore files along the path.
//      Standard gitignore negation (`!pattern`) is honored for layer 2.

const IGNORE_FILE_RE = /^\..*ignore$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "build", ".next", "coverage"]);

const ALWAYS_PRIVATE_BASENAMES = [
  /^\.env(?:\..+)?$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^\.htpasswd$/i,
  /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\..+)?$/i,
  /\.(?:pem|key|p12|pfx|keystore|jks|ppk)$/i,
  /^(?:secrets?|credentials?)(?:\.(?:json|ya?ml|toml|ini|txt|env))?$/i,
];

const ALWAYS_PRIVATE_DIRS = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  ".password-store",
]);

interface Rule {
  base: string; // absolute directory the pattern is relative to
  pattern: string;
  negated: boolean;
  dirOnly: boolean;
  hasSlash: boolean;
}

const dirCache = new Map<string, { key: string; rules: Rule[] }>();

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

export function isIgnoreFile(file: string): boolean {
  return IGNORE_FILE_RE.test(path.basename(file));
}

// Always-private check. Intentionally independent of the workspace so it also
// protects events that were written before ignore support existed.
export function isAlwaysPrivate(relPath: string): boolean {
  const segments = normalize(relPath).split("/").filter(Boolean);
  if (segments.length === 0) {
    return false;
  }
  const base = segments[segments.length - 1];
  if (IGNORE_FILE_RE.test(base)) {
    return true;
  }
  if (ALWAYS_PRIVATE_BASENAMES.some((re) => re.test(base))) {
    return true;
  }
  return segments.some((s) => ALWAYS_PRIVATE_DIRS.has(s.toLowerCase()));
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end > i) {
        out += pattern.slice(i, end + 1);
        i = end;
      } else {
        out += "\\[";
      }
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function parseIgnore(content: string, base: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of content.split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, "");
    if (!line || line.startsWith("#")) {
      continue;
    }
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    }
    if (line.startsWith("\\#") || line.startsWith("\\!")) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    let anchored = false;
    if (line.startsWith("/")) {
      anchored = true;
      line = line.slice(1);
    }
    if (!line) {
      continue;
    }
    rules.push({
      base,
      pattern: line,
      negated,
      dirOnly,
      hasSlash: anchored || line.includes("/"),
    });
  }
  return rules;
}

function matches(rule: Rule, relToBase: string, isDir: boolean): boolean {
  const rel = normalize(relToBase);
  if (!rel || rel.startsWith("../")) {
    return false;
  }
  const re = globToRegExp(rule.pattern);
  const segments = rel.split("/");

  if (rule.hasSlash) {
    if (re.test(rel)) {
      return true;
    }
    if (rule.dirOnly) {
      for (let i = 1; i < segments.length; i++) {
        if (re.test(segments.slice(0, i).join("/"))) {
          return true;
        }
      }
    }
    return false;
  }

  for (let i = 0; i < segments.length; i++) {
    if (!re.test(segments[i])) {
      continue;
    }
    if (rule.dirOnly && i === segments.length - 1 && !isDir) {
      return false;
    }
    return true;
  }
  return false;
}

function rulesInDir(dir: string): Rule[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((e) => e.isFile() && IGNORE_FILE_RE.test(e.name))
    .map((e) => e.name)
    .sort();

  const key = files
    .map((f) => {
      try {
        const st = fs.statSync(path.join(dir, f));
        return `${f}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${f}:missing`;
      }
    })
    .join("|");

  const cached = dirCache.get(dir);
  if (cached && cached.key === key) {
    return cached.rules;
  }

  const rules: Rule[] = [];
  for (const f of files) {
    try {
      rules.push(...parseIgnore(fs.readFileSync(path.join(dir, f), "utf8"), dir));
    } catch {
      /* unreadable ignore file: treat as absent */
    }
  }
  dirCache.set(dir, { key, rules });
  return rules;
}

function rulesForFile(workspaceRoot: string, abs: string): Rule[] {
  const relDir = path.relative(workspaceRoot, path.dirname(abs));
  if (!relDir || relDir === ".") {
    return rulesInDir(workspaceRoot);
  }
  if (relDir.startsWith("..") || path.isAbsolute(relDir)) {
    return [];
  }
  const dirs = [workspaceRoot];
  let current = workspaceRoot;
  for (const part of relDir.split(path.sep).filter(Boolean)) {
    if (SKIP_DIRS.has(part.toLowerCase())) {
      break;
    }
    current = path.join(current, part);
    dirs.push(current);
  }
  return dirs.flatMap(rulesInDir);
}

// True when a workspace-relative (or absolute) path must not be tracked.
// `isDir` matters for `dir/` patterns.
export function isPrivatePath(relPath: string, workspaceRoot?: string, isDir = false): boolean {
  const norm = normalize(relPath);
  if (isAlwaysPrivate(norm)) {
    return true;
  }
  if (!workspaceRoot) {
    return false;
  }
  const abs = path.isAbsolute(norm) ? path.normalize(norm) : path.resolve(workspaceRoot, norm);
  const rel = path.relative(workspaceRoot, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }

  let ignored = false;
  for (const rule of rulesForFile(workspaceRoot, abs)) {
    if (matches(rule, path.relative(rule.base, abs), isDir)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}
