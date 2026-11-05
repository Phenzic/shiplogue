import * as vscode from "vscode";
import { CloudClient } from "../cloud";
import { getAnalytics } from "../analytics";
import { CloudDraftSync, LocalOnlySync, setDraftSync } from "../draftHistorySync";
import { cfg } from "../config";
import { refreshDelivery } from "../delivery";
import { ShiploguePanel } from "../shiploguePanel";

let client: CloudClient | undefined;
let telemetryPrompted = false;

export function initCloud(context: vscode.ExtensionContext): CloudClient {
  client = new CloudClient(context);
  return client;
}

export function getCloudClient(): CloudClient | undefined {
  return client;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function maybePromptTelemetry(): Promise<void> {
  if (cfg().telemetryEnabled || telemetryPrompted) return;
  telemetryPrompted = true;
  const choice = await vscode.window.showInformationMessage(
    "Share anonymous usage metadata with Shiplogue? It helps measure adoption and prioritize integrations. No stand-up text, prompts, file paths, repository names, or error messages are sent.",
    "Enable anonymous usage",
    "Not now",
  );
  if (choice === "Enable anonymous usage") {
    await vscode.workspace
      .getConfiguration("shiplogue")
      .update("telemetry.enabled", true, vscode.ConfigurationTarget.Global);
  }
}

export async function connectCloud(): Promise<void> {
  if (!client) return;
  const key = await vscode.window.showInputBox({
    title: "Connect Shiplogue Cloud",
    prompt:
      "Paste the connector key from shiplogue.dev. It starts with shp_live_ and is stored in the OS keychain.",
    placeHolder: "shp_live_...",
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined) return;

  try {
    const me = await client.connect(key);
    if (me.workspace.features?.history) {
      setDraftSync(new CloudDraftSync(client));
    }
    await maybePromptTelemetry();
    void getAnalytics()?.track("connector.connected", { plan: me.workspace.plan });
    const delivery = await refreshDelivery(client);
    ShiploguePanel.updateDelivery(delivery);
    await vscode.window.showInformationMessage(
      `Connected to ${me.workspace.name}. Generated stand-ups will sync to Shiplogue.`,
    );
  } catch (error) {
    await vscode.window.showErrorMessage(`Shiplogue Cloud: ${message(error)}`);
  }
}

export async function disconnectCloud(): Promise<void> {
  if (!client) return;
  if (!(await client.hasKey())) {
    await vscode.window.showInformationMessage("Shiplogue Cloud is already disconnected.");
    return;
  }
  const analytics = getAnalytics();
  void analytics?.track("connector.disconnected", {});
  await analytics?.flush();
  await client.disconnect();
  const delivery = await refreshDelivery(client);
  ShiploguePanel.updateDelivery(delivery);
  await vscode.window.showInformationMessage(
    "Shiplogue Cloud disconnected. The connector key was removed; local generation still works.",
  );
}

export async function cloudStatus(): Promise<void> {
  if (!client) return;
  if (!(await client.hasKey())) {
    const action = await vscode.window.showWarningMessage(
      "Shiplogue Cloud is not connected. Connect a connector key to sync generated stand-ups.",
      "Connect",
    );
    if (action === "Connect") await connectCloud();
    return;
  }

  try {
    const me = await client.me();
    await vscode.window.showInformationMessage(
      `Connected to ${me.workspace.name} (${me.workspace.plan}) as ${me.connector.name}. Scopes: ${me.connector.scopes.join(", ") || "none"}.`,
    );
  } catch (error) {
    const action = await vscode.window.showWarningMessage(
      `Shiplogue Cloud: ${message(error)}`,
      "Connect a new key",
    );
    if (action === "Connect a new key") await connectCloud();
  }
}
