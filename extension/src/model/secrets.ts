import * as vscode from "vscode";
import { ActiveProviderType } from "../core/providers";

// The only place provider keys are read or written. Values live in the OS
// keychain via VS Code SecretStorage — never in settings, globalState, logs or
// error messages.
let secrets: vscode.SecretStorage | undefined;

export function setSecretStorage(storage: vscode.SecretStorage): void {
  secrets = storage;
}

export function secretStorageAvailable(): boolean {
  return secrets !== undefined;
}

export function providerKeyName(type: ActiveProviderType): string {
  return `standup.provider.${type}.apiKey`;
}

export async function getProviderKey(type: ActiveProviderType): Promise<string | undefined> {
  if (!secrets) {
    return undefined;
  }
  const value = await secrets.get(providerKeyName(type));
  return value && value.trim() ? value.trim() : undefined;
}

export async function storeProviderKey(type: ActiveProviderType, key: string): Promise<void> {
  if (!secrets) {
    throw new Error("Secret storage is unavailable in this host.");
  }
  await secrets.store(providerKeyName(type), key.trim());
}

export async function deleteProviderKey(type: ActiveProviderType): Promise<void> {
  await secrets?.delete(providerKeyName(type));
}
