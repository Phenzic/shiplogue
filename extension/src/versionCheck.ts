export const EXTENSION_ID = "phenzic.shiplogue";
export const MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${EXTENSION_ID}`;
export const OPEN_VSX_URL = "https://open-vsx.org/extension/phenzic/shiplogue";
// Opens Settings filtered to the editor-wide auto-update toggle. The extension
// cannot change this setting itself; it can only take the user there.
export const AUTO_UPDATE_SETTINGS_QUERY = "@id:extensions.autoUpdate";

const MARKETPLACE_API =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const OPEN_VSX_API = "https://open-vsx.org/api/phenzic/shiplogue";

export type VersionContext = {
  extension?: { packageJSON?: { version?: string } };
};

export type UpdateSource = "marketplace" | "openvsx";

export type LatestVersion = {
  version: string;
  source: UpdateSource;
  url: string;
};

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion?: string;
  source?: UpdateSource;
  updateAvailable: boolean;
  marketplaceUrl: string;
  openVsxUrl: string;
};

export type UpdateCheckOptions = {
  fetchImpl?: typeof fetch;
};

export async function getCurrentVersion(context: VersionContext): Promise<string> {
  const version = context?.extension?.packageJSON?.version;
  const value = (version ?? "").trim();
  return value || "0.0.0";
}

/** Numeric semver compare; negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

async function fetchMarketplaceVersion(
  fetchImpl: typeof fetch,
): Promise<LatestVersion | undefined> {
  try {
    const res = await fetchImpl(MARKETPLACE_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json;api-version=7.2-preview.1",
      },
      body: JSON.stringify({
        filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }] }],
        flags: 950,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      results?: Array<{ extensions?: Array<{ versions?: Array<{ version?: string }> }> }>;
    };
    const version = data.results?.[0]?.extensions?.[0]?.versions?.[0]?.version;
    return version ? { version, source: "marketplace", url: MARKETPLACE_URL } : undefined;
  } catch {
    return undefined;
  }
}

async function fetchOpenVsxVersion(fetchImpl: typeof fetch): Promise<LatestVersion | undefined> {
  try {
    const res = await fetchImpl(OPEN_VSX_API, {
      headers: { Accept: "application/json", "User-Agent": "shiplogue" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: string };
    return data.version ? { version: data.version, source: "openvsx", url: OPEN_VSX_URL } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Latest published version across Marketplace and Open VSX. These registries
 * are the source of truth for the install channel — GitHub Releases are only a
 * fallback for the VSIX and unauthenticated GitHub API calls are rate-limited.
 * Failures return undefined and never break activation.
 */
export async function fetchLatestVersion(
  fetchImpl: typeof fetch = fetch,
): Promise<LatestVersion | undefined> {
  const [marketplace, openvsx] = await Promise.all([
    fetchMarketplaceVersion(fetchImpl),
    fetchOpenVsxVersion(fetchImpl),
  ]);
  const candidates = [marketplace, openvsx].filter((v): v is LatestVersion => Boolean(v));
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, current) =>
    compareVersions(current.version, best.version) > 0 ? current : best,
  );
}

/** Compare the running extension version against the latest published listing. */
export async function checkForUpdate(
  context: VersionContext,
  options: UpdateCheckOptions = {},
): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentVersion(context);
  const latest = await fetchLatestVersion(options.fetchImpl);
  const latestVersion = latest?.version;
  return {
    currentVersion,
    latestVersion,
    source: latest?.source,
    updateAvailable: Boolean(latest && compareVersions(currentVersion, latest.version) < 0),
    marketplaceUrl: MARKETPLACE_URL,
    openVsxUrl: OPEN_VSX_URL,
  };
}
