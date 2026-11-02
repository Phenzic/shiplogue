// Redaction at the write boundary (A1): nothing secret ever reaches disk.
// Tokens/keys are replaced with [redacted]; sensitive files are skipped
// entirely; free text is capped and stripped of control chars.

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style keys
  /ghp_[A-Za-z0-9]{20,}/g, // GitHub PAT
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
  /x-api-key\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}["']?/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

// Paths we never record at all (dotfiles with secrets, keys/certs, binaries).
const SKIP_PATH = /(^|\/)(\.env(\.|$)|.*\.(pem|key|p12|pfx|cer|crt|der)$|id_rsa|id_ed25519|node_modules\/|\.git\/|dist\/|out\/|build\/)/i;
const BINARY_EXT = /\.(png|jpe?g|gif|ico|pdf|zip|gz|tar|woff2?|ttf|otf|exe|dll|so|dylib|bin|gguf)$/i;

export function shouldSkipPath(p: string): boolean {
  return SKIP_PATH.test(p) || BINARY_EXT.test(p);
}

export function redactText(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  // Strip control chars except \n.
  // eslint-disable-next-line no-control-regex
  return out.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export const CAPS = {
  text: 2048, // prompt/response
  toolOutput: 1024,
  diff: 4096,
} as const;

export function cap(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function redactAndCap(s: string, max: number): string {
  return cap(redactText(s), max);
}
