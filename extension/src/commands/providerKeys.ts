import * as vscode from "vscode";
import {
  ActiveProviderType,
  PROVIDER_LABELS,
  ProviderConfig,
  ProviderError,
  adapterFor,
  redactSecrets,
} from "../core/providers";
import { cfg } from "../config";
import {
  deleteProviderKey,
  getProviderKey,
  secretStorageAvailable,
  storeProviderKey,
} from "../model/secrets";
import { BackendUnavailableError, loadProviderConfig } from "../model/registry";

// Hosted providers need a key; a local OpenAI-compatible endpoint may not.
const TYPES: ActiveProviderType[] = ["anthropic", "openai", "google", "openai-compatible"];

function labelOf(type: ActiveProviderType): string {
  return PROVIDER_LABELS[type];
}

// Display order: the currently configured provider first, so re-running the
// command edits the thing the user is already using.
function orderedTypes(): ActiveProviderType[] {
  const current = cfg().providerType;
  const rest = TYPES.filter((t) => t !== current);
  return current !== "none" && TYPES.includes(current as ActiveProviderType)
    ? [current as ActiveProviderType, ...rest]
    : TYPES;
}

async function pickType(placeHolder: string): Promise<ActiveProviderType | undefined> {
  const items = orderedTypes().map((type) => ({
    label: labelOf(type),
    description: type === cfg().providerType ? "currently configured" : undefined,
    type,
  }));
  const picked = (await vscode.window.showQuickPick(items, { placeHolder })) as
    | { type: ActiveProviderType }
    | undefined;
  return picked?.type;
}

// Model ids that can't write a stand-up; listing them just adds noise.
const NON_CHAT = /(embedding|whisper|tts|dall-e|moderation|audio|realtime|image|transcrib)/i;

async function listModels(config: ProviderConfig): Promise<string[]> {
  try {
    const models = await adapterFor(config.type).listModels(config);
    const filtered = config.type === "openai" ? models.filter((m) => !NON_CHAT.test(m)) : models;
    return filtered.sort((a, b) => a.localeCompare(b));
  } catch (e) {
    // A model list is a convenience, not a requirement: report and let the
    // user type the id instead.
    const message = e instanceof ProviderError ? e.message : "Could not list models.";
    void vscode.window.showWarningMessage(`Standup: ${message} You can enter a model id manually.`);
    return [];
  }
}

async function pickModel(config: ProviderConfig): Promise<string | undefined> {
  const models = await listModels(config);
  if (models.length > 0) {
    // Cancel means cancel; manual entry is the fallback when listing failed.
    return vscode.window.showQuickPick(models, {
      placeHolder: `Which ${labelOf(config.type)} model should write your stand-up?`,
      matchOnDescription: false,
    });
  }
  const typed = await vscode.window.showInputBox({
    title: `Standup: ${labelOf(config.type)} model`,
    prompt: "Model id to use for generating stand-ups.",
    value: cfg().providerModel,
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim() ? undefined : "A model id is required."),
  });
  return typed?.trim() || undefined;
}

async function setConfigValue(key: string, value: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("standup")
    .update(key, value, vscode.ConfigurationTarget.Global);
}

export async function setProviderKey(): Promise<void> {
  if (!secretStorageAvailable()) {
    void vscode.window.showErrorMessage(
      "Standup: this editor does not expose secret storage, so API keys can't be saved. Use Ollama instead.",
    );
    return;
  }
  const type = await pickType("Which provider should write your stand-ups?");
  if (!type) {
    return;
  }
  const label = labelOf(type);
  // Replacing a key is optional: an existing key is kept if the field is left
  // blank, so re-running this command to change models doesn't force a re-paste.
  const existingKey = await getProviderKey(type);

  let baseUrl: string | undefined;
  if (type === "openai-compatible") {
    const existing = cfg().providerBaseUrl;
    const raw = await vscode.window.showInputBox({
      title: "Standup: endpoint base URL",
      prompt: "Base URL of the OpenAI-compatible API (for example http://localhost:1234/v1).",
      value: existing || "http://localhost:1234/v1",
      ignoreFocusOut: true,
      validateInput: (v) => (/^https?:\/\/\S+$/i.test(v.trim()) ? undefined : "Enter an http(s) URL."),
    });
    if (!raw) {
      return;
    }
    baseUrl = raw.trim().replace(/\/+$/, "");
  }

  const key = await vscode.window.showInputBox({
    title: `Standup: ${label} API key`,
    prompt:
      type === "openai-compatible"
        ? "API key, if the endpoint needs one. Stored in the OS keychain, never in settings."
        : existingKey
          ? `A ${label} key is already stored. Paste a new one, or leave blank to keep it.`
          : `Paste your ${label} API key. It is stored in the OS keychain (VS Code SecretStorage), never in settings or logs.`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed && type !== "openai-compatible" && !existingKey) {
        return "A key is required for this provider.";
      }
      if (/\s/.test(trimmed)) {
        return "Keys don't contain spaces — check for a copy/paste error.";
      }
      return undefined;
    },
  });

  // Escape (undefined) cancels. An empty string is deliberate: keep an existing
  // key, or no auth for a local endpoint.
  if (key === undefined) {
    return;
  }
  const trimmedKey = key.trim();

  if (trimmedKey) {
    await storeProviderKey(type, trimmedKey);
  } else if (!existingKey) {
    // No key was ever stored for a keyless endpoint: nothing to remove.
    await deleteProviderKey(type);
  }

  const config: ProviderConfig = {
    type,
    model: cfg().providerModel,
    apiKey: trimmedKey || existingKey || undefined,
    baseUrl: baseUrl || cfg().providerBaseUrl || undefined,
    maxOutputTokens: cfg().providerMaxOutputTokens,
  };
  const model = await pickModel(config);
  if (!model) {
    // The key is stored; keep the provider type so a later run only asks for
    // the model.
    await setConfigValue("provider.type", type);
    void vscode.window.showInformationMessage(
      `Standup: ${label} key saved, but no model chosen yet. Run "Standup: Set API Key" again to finish.`,
    );
    return;
  }

  await setConfigValue("provider.type", type);
  if (baseUrl) {
    await setConfigValue("provider.baseUrl", baseUrl);
  }
  await setConfigValue("provider.model", model);
  await setConfigValue("model.backend", "provider");

  void vscode.window.showInformationMessage(
    `Standup will use ${label} — ${model}. Run "Standup: Test Provider" to check the key.`,
  );
}

export async function clearProviderKey(): Promise<void> {
  if (!secretStorageAvailable()) {
    void vscode.window.showErrorMessage("Standup: this editor does not expose secret storage.");
    return;
  }
  const type = await pickType("Remove the stored API key for which provider?");
  if (!type) {
    return;
  }
  await deleteProviderKey(type);
  if (cfg().providerType === type) {
    await setConfigValue("provider.type", "none");
    await setConfigValue("model.backend", "auto");
  }
  void vscode.window.showInformationMessage(
    `Standup: removed the stored ${labelOf(type)} key.`,
  );
}

// Exercises the same adapter path generateStandup uses, without gathering
// activity: proves the key, endpoint and model id all work together.
export async function testProvider(): Promise<void> {
  let config: ProviderConfig | undefined;
  try {
    config = await loadProviderConfig();
  } catch (e) {
    config = undefined;
  }
  if (!config) {
    const message =
      "No provider is configured. Run \"Standup: Set API Key\" first, or switch standup.model.backend to 'auto'.";
    void vscode.window.showErrorMessage(`Standup: ${message}`);
    return;
  }

  const label = labelOf(config.type);
  try {
    const res = await adapterFor(config.type).generate(
      {
        prompt: "Reply with the single word OK.",
        temperature: 0,
        maxTokens: 16,
      },
      config,
    );
    void vscode.window.showInformationMessage(
      `Standup: ${label} works — ${config.model} replied "${redactSecrets(res.text).slice(0, 40)}".`,
    );
  } catch (e) {
    const message =
      e instanceof ProviderError || e instanceof BackendUnavailableError
        ? e.message
        : `Something went wrong: ${(e as Error)?.message ?? e}`;
    void vscode.window.showErrorMessage(`Standup: ${redactSecrets(message)}`);
  }
}
