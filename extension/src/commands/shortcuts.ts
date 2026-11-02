import * as vscode from "vscode";

// Opens the Keyboard Shortcuts editor filtered to the generate command, so a
// user who already has a conflicting keymap can rebind it without hunting.
export async function configureShortcut(): Promise<void> {
  await vscode.commands.executeCommand(
    "workbench.action.openGlobalKeybindings",
    "standupDraft.generate",
  );
}
