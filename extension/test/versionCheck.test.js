"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkForUpdate, compareVersions, fetchLatestVersion } = require("../out/versionCheck");

function fakeContext(version) {
  return { extension: { packageJSON: { version } } };
}

// Fake registries: the Marketplace query is a POST, Open VSX is a GET.
function fakeRegistries({ marketplace, openvsx } = {}) {
  return async (url) => {
    const target = String(url);
    if (target.includes("marketplace.visualstudio.com")) {
      return {
        ok: Boolean(marketplace),
        status: marketplace ? 200 : 404,
        json: async () => ({
          results: marketplace
            ? [{ extensions: [{ versions: [{ version: marketplace }] }] }]
            : [],
        }),
      };
    }
    if (target.includes("open-vsx.org")) {
      return {
        ok: Boolean(openvsx),
        status: openvsx ? 200 : 404,
        json: async () => (openvsx ? { version: openvsx } : {}),
      };
    }
    throw new Error(`unexpected URL: ${target}`);
  };
}

test("compareVersions orders numeric semver segments", () => {
  assert.equal(compareVersions("0.1.7", "0.1.8"), -1);
  assert.equal(compareVersions("0.1.8", "0.1.7"), 1);
  assert.equal(compareVersions("0.1.8", "0.1.8"), 0);
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("1.2", "1.10"), -1);
});

test("fetchLatestVersion reads Marketplace and Open VSX", async () => {
  const latest = await fetchLatestVersion(
    fakeRegistries({ marketplace: "0.1.8", openvsx: "0.1.9" }),
  );
  assert.equal(latest.version, "0.1.9");
  assert.equal(latest.source, "openvsx");
  assert.match(latest.url, /open-vsx\.org/);
});

test("fetchLatestVersion falls back when one registry fails", async () => {
  const latest = await fetchLatestVersion(fakeRegistries({ marketplace: "0.1.8" }));
  assert.deepEqual(latest, {
    version: "0.1.8",
    source: "marketplace",
    url: "https://marketplace.visualstudio.com/items?itemName=phenzic.shiplogue",
  });
});

test("fetchLatestVersion returns undefined when both registries fail", async () => {
  assert.equal(await fetchLatestVersion(fakeRegistries({})), undefined);
});

test("checkForUpdate reports an available update from either registry", async () => {
  const result = await checkForUpdate(fakeContext("0.1.7"), {
    fetchImpl: fakeRegistries({ marketplace: "0.1.8", openvsx: "0.1.9" }),
  });
  assert.equal(result.currentVersion, "0.1.7");
  assert.equal(result.latestVersion, "0.1.9");
  assert.equal(result.source, "openvsx");
  assert.equal(result.updateAvailable, true);
  assert.match(result.marketplaceUrl, /marketplace\.visualstudio\.com/);
  assert.match(result.openVsxUrl, /open-vsx\.org/);
});

test("checkForUpdate reports no update when versions match", async () => {
  const result = await checkForUpdate(fakeContext("0.1.8"), {
    fetchImpl: fakeRegistries({ marketplace: "0.1.8", openvsx: "0.1.8" }),
  });
  assert.equal(result.updateAvailable, false);
});

test("checkForUpdate is silent when registries are unreachable", async () => {
  const result = await checkForUpdate(fakeContext("0.1.8"), { fetchImpl: fakeRegistries({}) });
  assert.equal(result.latestVersion, undefined);
  assert.equal(result.updateAvailable, false);
});
