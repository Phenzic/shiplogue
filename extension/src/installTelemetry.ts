import * as vscode from "vscode";
import * as crypto from "crypto";
import { cfg } from "./config";

const INSTALL_ID_KEY = "shiplogue.installId";
const PINGED_VERSION_KEY = "shiplogue.installTelemetry.pingedVersion";

/**
 * One anonymous presence ping per install/version. This is not a download
 * counter: it counts installs that activated with telemetry enabled. The ID is
 * random and local; no IP address, account, workspace, or activity is sent.
 */
export async function reportInstall(context: vscode.ExtensionContext): Promise<void> {
  if (!cfg().installTelemetryEnabled) return;
  if (vscode.env.isTelemetryEnabled !== true) return;

  const version = context.extension?.packageJSON?.version ?? "0.0.0";
  if (context.globalState.get<string>(PINGED_VERSION_KEY) === version) return;

  let installId = context.globalState.get<string>(INSTALL_ID_KEY);
  if (!installId) {
    installId = crypto.randomUUID();
    await context.globalState.update(INSTALL_ID_KEY, installId);
  }

  try {
    const response = await fetch(`${cfg().cloudUrl.replace(/\/+$/, "")}/api/v1/extension/installs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId,
        version,
        platform: process.platform,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      await context.globalState.update(PINGED_VERSION_KEY, version);
    }
  } catch {
    // Presence is best effort; never block activation.
  }
}
