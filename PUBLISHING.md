# Publishing Shiplogue

This is the release checklist for the extension and the Shiplogue Agent/plugin.

## 1. Extension 0.1.15

Version, changelog, release notes, and VSIX are already prepared:

- `extension/package.json` — `0.1.15`
- `extension/CHANGELOG.md` — `[0.1.15]`
- `RELEASE_NOTES_0.1.15.md`
- `extension/shiplogue-0.1.15.vsix`
- checks: `npm test` = **263 pass / 0 fail / 10 skipped**, `tsc` clean.

### Publish with GitHub Actions (recommended)

1. Commit and push:
   ```bash
   git add extension/package.json extension/package-lock.json \
     extension/CHANGELOG.md RELEASE_NOTES_0.1.15.md
   git commit -m "release: 0.1.15"
   git push origin main
   git push origin v0.1.15     # tag is already created locally
   ```
2. GitHub → **Actions** → **Publish to Visual Studio Marketplace** → **Run workflow** on `main`.
3. The workflow builds its own VSIX (the local `extension/shiplogue-0.1.15.vsix`
is gitignored and only for manual testing). It:
   - runs tests,
   - publishes to the VS Code Marketplace via OIDC,
   - packages and publishes to Open VSX with `OVSX_TOKEN`,
   - creates the GitHub release from `RELEASE_NOTES_0.1.15.md`.

The `v0.1.15` tag is already created locally; pushing it anchors the GitHub
release to this commit. The workflow creates the GitHub release from the notes.

### Manual fallback

```bash
cd extension
npx --yes @vscode/vsce@4.1.0 publish
npx --yes ovsx publish shiplogue-0.1.15.vsix -p "$OVSX_TOKEN"
```

Then create the GitHub release and attach `extension/shiplogue-0.1.15.vsix`.

## 2. Shiplogue Agent + Claude Code plugin

The plugin is **validation-ready**, but the npm package is not published yet.

### Current blockers

- npm is not authenticated on this machine (`npm whoami` fails).
- The `@phenzic` npm scope does not resolve (404); create/claim it first.
- `plugins/shiplogue/.mcp.json` runs `shiplogue mcp`, so users need the global
  binary on `PATH` (or switch it to `npx`).
- Agent cloud endpoints (`/api/v1/agent/reports`, `/events`, `/summary-settings`)
  still need cloud confirmation.

Already prepared: agent/plugin version **0.3.1**, `private` removed, and
`publishConfig.access` set to `public`.

### Publish the agent package with GitHub Actions (recommended)

The workflow is [`.github/workflows/publish-agent.yml`](.github/workflows/publish-agent.yml).

1. Add a repository secret **`NPM_TOKEN`**: GitHub → Settings → Secrets and
   variables → Actions → New repository secret. Use an npm automation token that
   can publish `@phenzic/*`.
2. Bump **both** `agent/package.json` and
   `plugins/shiplogue/.claude-plugin/plugin.json` to the same version.
3. Commit and push.
4. GitHub → **Actions** → **Publish Shiplogue Agent** → **Run workflow**.
   - Run once with `dry_run: true` to verify.
   - Run again with `dry_run: false` to publish with provenance.
5. The workflow refuses to overwrite an existing version, runs tests,
   `check:skill`, `npm pack --dry-run`, then publishes and verifies the version.

### Manual publish fallback

1. Log in and create/claim the scope:
   ```bash
   npm login
   npm org create phenzic        # if it does not exist
   ```
2. Confirm `agent/package.json` has version `0.3.1`, no `private` flag, and
   `publishConfig.access: "public"` (all already set).
3. Build and test (the skill check must pass):
   ```bash
   cd agent
   npm run build
   npm test
   npm run check:skill
   npm pack --dry-run
   ```
4. Publish:
   ```bash
   npm publish --access public --provenance
   ```
5. Verify:
   ```bash
   npm install -g @phenzic/shiplogue-agent
   shiplogue status
   shiplogue mcp
   ```
   `shiplogue mcp` is a local stdio server. **Do not host an MCP server.**

### Publish the Claude Code plugin

1. Plugin manifest is already aligned at `0.3.1`.
2. Decide the MCP launch mode:
   - global install: keep `"command": "shiplogue"`, or
   - zero-install: use `"command": "npx", "args": ["-y", "@phenzic/shiplogue-agent", "mcp"]`.
   Hooks still need the installed binary, so recommend the global install.
3. Validate and test:
   ```bash
   claude plugin validate ./plugins/shiplogue
   claude plugin validate .
   ```
4. Push the repo (the marketplace reads `.claude-plugin/marketplace.json`).
5. Install from the public repo:
   ```bash
   claude plugin marketplace add Phenzic/shiplogue
   claude plugin install shiplogue@shiplogue
   ```
6. In Claude Code, run `/shiplogue:daily`.

### Cursor Agent

No marketplace publish is required:

```bash
shiplogue hooks install --agent cursor
```

Add the MCP server to Cursor's MCP config:

```json
{
  "mcpServers": {
    "shiplogue": { "command": "shiplogue", "args": ["mcp"] }
  }
}
```

### Codex CLI

```bash
shiplogue hooks install --agent codex
```

Optional notify hook:

```toml
# ~/.codex/config.toml
notify = ["shiplogue", "hook", "codex", "--notify"]
```

MCP config:

```toml
[mcp_servers.shiplogue]
command = "shiplogue"
args = ["mcp"]
```

## 3. Release order

1. Extension `0.1.15` (Marketplace + Open VSX + GitHub release).
2. npm `@phenzic/shiplogue-agent` `0.3.1`.
3. Claude plugin version alignment + public repo.
4. Cursor/Codex docs/config verification.
5. Cloud endpoint confirmation.

## 4. Version ladder

`0.1.x` continues through **0.1.20**. The next minor after that is **0.2.1**,
not `0.2.0`. See `ROADMAP.md`.
