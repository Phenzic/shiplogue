import * as vscode from "vscode";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// Builds the panel document from media/ (panel.html/css/js) with a strict CSP
// and a per-load nonce. Assets are referenced through asWebviewUri, which is
// the only origin VS Code will serve them from.
export function panelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const media = vscode.Uri.joinPath(extensionUri, "media");
  const read = (file: string) => fs.readFileSync(path.join(media.fsPath, file), "utf8");

  const nonce = crypto.randomBytes(16).toString("base64");
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css")).toString();
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js")).toString();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return read("panel.html")
    .replace(/\{\{csp\}\}/g, csp)
    .replace(/\{\{nonce\}\}/g, nonce)
    .replace(/\{\{cssUri\}\}/g, cssUri)
    .replace(/\{\{jsUri\}\}/g, jsUri);
}

// Local resource roots for the webview (media/ only).
export function mediaRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "media");
}
