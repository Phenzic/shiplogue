import * as vscode from "vscode";

// Opens the editor's keyboard-shortcuts UI filtered to the generate command.
// VS Code-compatible hosts (Cursor, Antigravity, VSCodium, ...) expose the same
// workbench command; if a host does not, the caller reports the failure.
export async function configureShortcut(): Promise<void> {
  await vscode.commands.executeCommand(
    "workbench.action.openGlobalKeybindings",
    "shiplogue.generate",
  );
}
