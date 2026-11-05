import * as vscode from "vscode";
import * as crypto from "crypto";

export type LocalWorkspace = {
  /** Stable, non-reversible identifier for this local folder. */
  id: string;
  name: string;
  folder: vscode.WorkspaceFolder;
};

export function workspaceForFolder(folder: vscode.WorkspaceFolder): LocalWorkspace {
  const id = crypto.createHash("sha1").update(folder.uri.fsPath).digest("hex").slice(0, 20);
  return { id, name: folder.name, folder };
}

/**
 * Local workspaces are IDE project folders, not cloud teams. Prefer the folder
 * containing the active editor; fall back to the first folder in the window.
 */
export function activeWorkspace(): LocalWorkspace | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return undefined;

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const normalized = activeUri.fsPath.replace(/\\/g, "/");
    const owner = folders
      .filter((folder) => {
        const root = folder.uri.fsPath.replace(/\\/g, "/").replace(/\/$/, "");
        return normalized === root || normalized.startsWith(`${root}/`);
      })
      .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0];
    if (owner) return workspaceForFolder(owner);
  }

  return workspaceForFolder(folders[0]);
}

export function allWorkspaces(): LocalWorkspace[] {
  return (vscode.workspace.workspaceFolders ?? []).map(workspaceForFolder);
}
