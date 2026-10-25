import * as vscode from "vscode";
import { Store } from "./store";
import { ActivityEvent } from "./types";
import { normalizeFolderPath, normalizeSlashes } from "./paths";

// Watches editor activity and records low-noise events: every save, and at most
// one "edit" heartbeat per file per throttle window. Skips non-file documents
// and noise paths (node_modules, .git, dist/out).
export class Tracker {
  private disposables: vscode.Disposable[] = [];
  private lastEdit = new Map<string, number>();
  private static EDIT_THROTTLE_MS = 120_000; // 2 min

  constructor(private store: Store) {}

  start(): void {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => this.record(doc, "save")),
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e.document)),
    );
  }

  private onChange(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const now = Date.now();
    const last = this.lastEdit.get(key) ?? 0;
    if (now - last < Tracker.EDIT_THROTTLE_MS) {
      return;
    }
    this.lastEdit.set(key, now);
    this.record(doc, "edit");
  }

  private record(doc: vscode.TextDocument, type: "save" | "edit"): void {
    if (doc.uri.scheme !== "file" || doc.isUntitled) {
      return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    // Normalize separators at record time: Windows emits backslashes, and the
    // stored log must compare cleanly across platforms.
    const rel = normalizeSlashes(
      folder ? vscode.workspace.asRelativePath(doc.uri, false) : doc.fileName,
    );

    if (/(^|[\\/])(node_modules|\.git|dist|out|build|\.next|coverage)([\\/]|$)/.test(rel)) {
      return;
    }

    const ev: ActivityEvent = {
      ts: new Date().toISOString(),
      type,
      file: rel,
      lang: doc.languageId,
      project: folder?.name ?? "(no folder)",
      projectPath: folder ? normalizeFolderPath(folder.uri.fsPath) : undefined,
    };
    this.store.add(ev);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
