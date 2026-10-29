"use strict";
// Shared test utilities: vscode stub injection, temp dirs, mock HTTP servers,
// and git fixtures.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");

// Redirect `require("vscode")` to the stub before any compiled module loads.
function installVscodeStub() {
  const Module = require("module");
  const stubPath = require.resolve("./vscode-stub.js");
  if (!Module.__standupPatched) {
    const orig = Module._resolveFilename;
    Module._resolveFilename = function (request, ...rest) {
      if (request === "vscode") return stubPath;
      return orig.call(this, request, ...rest);
    };
    Module.__standupPatched = true;
  }
  const mod = require(stubPath);
  mod.stub.reset();
  return mod;
}

function tmpDir(prefix = "standup-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Fake ExtensionContext: on-disk storage + in-memory globalState that persists
// across contexts for the same storage dir (mirrors VS Code globalState).
const stateStores = new Map();
// SecretStorage is separate from globalState and also persists per storage dir,
// mirroring the OS keychain surviving a reload.
const secretStores = new Map();
function makeContext(storageDir) {
  if (!stateStores.has(storageDir)) stateStores.set(storageDir, new Map());
  const state = stateStores.get(storageDir);
  if (!secretStores.has(storageDir)) secretStores.set(storageDir, new Map());
  const secretValues = secretStores.get(storageDir);
  return {
    globalStorageUri: { fsPath: storageDir },
    globalState: {
      get(key, def) {
        return state.has(key) ? state.get(key) : def;
      },
      update(key, value) {
        state.set(key, value);
        return Promise.resolve();
      },
    },
    secrets: {
      get(key) {
        return Promise.resolve(secretValues.get(key));
      },
      store(key, value) {
        secretValues.set(key, value);
        return Promise.resolve();
      },
      delete(key) {
        secretValues.delete(key);
        return Promise.resolve();
      },
      onDidChange() {
        return { dispose() {} };
      },
    },
    subscriptions: [],
    extensionPath: process.cwd(),
    __state: state,
    __secrets: secretValues,
  };
}

// Start an HTTP server whose handler returns { status?, headers?, body? }.
function startServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* leave as text */
      }
      const rec = { method: req.method, url: req.url, headers: req.headers, body: parsed };
      requests.push(rec);
      let out;
      try {
        out = await handler(rec);
      } catch (e) {
        out = { status: 500, body: { error: String(e) } };
      }
      const status = out?.status ?? 200;
      const body =
        out?.body === undefined
          ? undefined
          : typeof out.body === "string"
            ? out.body
            : JSON.stringify(out.body);
      try {
        res.writeHead(status, {
          "Content-Type": "application/json",
          ...(out?.headers ?? {}),
        });
        res.end(body);
      } catch {
        /* client went away mid-request (cancelled generation) */
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Replace global.fetch only for GitHub API calls; everything else passes through.
function interceptGithub(handler) {
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.github.com")) {
      return handler(u, init);
    }
    return realFetch(url, init);
  };
  return () => {
    global.fetch = realFetch;
  };
}

function ghResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Internal Server Error",
    json: async () => body,
  };
}

// Create a git repo with a GitHub-style origin and a couple of commits.
function makeGitRepo({ email = "dev@example.com", name = "Dev" } = {}) {
  const dir = tmpDir("standup-git-");
  const run = (args, opts = {}) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: opts.name ?? name,
        GIT_AUTHOR_EMAIL: opts.email ?? email,
        GIT_COMMITTER_NAME: opts.name ?? name,
        GIT_COMMITTER_EMAIL: opts.email ?? email,
      },
    });
  run(["init", "-q"]);
  run(["config", "user.email", email]);
  run(["config", "user.name", name]);
  run(["config", "commit.gpgsign", "false"]);
  run(["remote", "add", "origin", "git@github.com:acme/demo.git"]);

  fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 1;\n");
  run(["add", "a.ts"]);
  run(["commit", "-q", "-m", "feat(api): add health endpoint", "-m", "Adds /health with a 200 response.\nUsed by the deploy probe."]);

  fs.writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
  fs.writeFileSync(path.join(dir, "b.md"), "# Docs\n");
  run(["add", "-A"]);
  run(["commit", "-q", "-m", "docs: document the health endpoint"]);

  return { dir, run };
}

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

module.exports = {
  installVscodeStub,
  tmpDir,
  makeContext,
  startServer,
  interceptGithub,
  ghResponse,
  makeGitRepo,
  ymd,
  nowIso,
  fs,
  path,
  os,
};
