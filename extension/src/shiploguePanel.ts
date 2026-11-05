import * as vscode from "vscode";
import { cfg } from "./config";
import { DetailLevel, State, Tone } from "./state";
import type { PanelVerification } from "./panelVerification";
import type { DraftEntry } from "./draftHistory";
import { mediaRoot, panelHtml } from "./webview";
import { getDeliveryState, hasDeliveryTarget } from "./delivery";

// The stand-up panel. The UI itself lives in media/ (panel.html/css/js) and is
// loaded with a strict CSP; this class owns the message protocol and the
// extension-host side effects.

export interface DraftPayload {
  markdown: string;
  summary: { commits: number; files: number; github: number; notes?: string[] };
  // Non-modal caveats (e.g. grounding removals) shown in the status line.
  warnings?: string[];
  // Which engine wrote the draft, e.g. "Ollama · llama3.2".
  modelLabel?: string;
  // Short provenance under the model chip, e.g. "OpenAI BYOK".
  modelNote?: string;
  verification?: PanelVerification;
  projectName?: string;
  // Per-draft history id (DraftHistory entry).
  draftId?: string;
  stats?: { durationMs?: number; inputTokens?: number; outputTokens?: number };
  generatedAt?: string;
}

export interface HistoryPagePayload {
  entries: DraftEntry[];
  cursor?: string;
  append?: boolean;
}

export interface PanelCallbacks {
  onRegenerate: () => void;
  onCancel?: () => void;
  onCopy?: (format: "markdown" | "plain", text: string, draftId?: string) => void;
  // Fired after a successful send from the draft view (when delivery exists).
  onSent?: (draftId: string | undefined, targets: string[]) => void;
  // The History tab asks for a page; respond with panel.setHistoryPage().
  onHistoryRequest?: (opts: { query?: string; cursor?: string }) => void;
  onRestore?: (id: string) => void;
  onSendStored?: (id: string) => void;
  // Delivery is executed by Shiplogue Cloud (Pro); the panel only asks.
  onSend?: (draftId: string | undefined, markdown: string) => void;
  onFeedback?: (value: "up" | "down", backend: string) => void;
}

let extensionUri: vscode.Uri | undefined;

export class ShiploguePanel {
  private static current: ShiploguePanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private ready = false;
  private pendingHistory = false;

  static init(context: { extensionUri: vscode.Uri }): void {
    extensionUri = context.extensionUri;
  }

  static show(callbacks: PanelCallbacks, state: State, projectName?: string): ShiploguePanel {
    if (ShiploguePanel.current) {
      ShiploguePanel.current.callbacks = callbacks;
      ShiploguePanel.current.projectName = projectName;
      ShiploguePanel.current.state = state;
      ShiploguePanel.current.syncDetail();
      ShiploguePanel.current.panel.reveal();
      return ShiploguePanel.current;
    }
    const uri = extensionUri ?? vscode.Uri.joinPath(vscode.Uri.file(__dirname), "..");
    const panel = vscode.window.createWebviewPanel(
      "shiplogue",
      "Shiplogue",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot(uri)],
      },
    );
    ShiploguePanel.current = new ShiploguePanel(panel, callbacks, state, projectName, uri);
    return ShiploguePanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private callbacks: PanelCallbacks,
    private state: State,
    private projectName: string | undefined,
    private uri: vscode.Uri,
  ) {
    this.panel = panel;
    this.panel.webview.html = panelHtml(panel.webview, uri);
    this.syncDetail();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((msg) => this.handle(msg), null, this.disposables);
  }

  setLoading(label: string): void {
    this.panel.webview.postMessage({ kind: "loading", label });
  }

  setDraft(p: DraftPayload): void {
    const c = cfg();
    this.panel.webview.postMessage({
      kind: "draft",
      markdown: p.markdown,
      summary: p.summary,
      warnings: p.warnings,
      modelLabel: p.modelLabel,
      modelNote: p.modelNote,
      verification: p.verification,
      projectName: p.projectName ?? this.projectName,
      draftId: p.draftId,
      stats: p.stats,
      generatedAt: p.generatedAt,
      // Send is shown only when the connected workspace can post via Shiplogue
      // Cloud (Pro); the label names the route.
      sendLabel: getDeliveryState().label,
      target: hasDeliveryTarget() ? "targets" : "",
      detail: c.detail,
      tone: c.tone,
    });
  }

  setHistoryPage(page: HistoryPagePayload): void {
    this.panel.webview.postMessage({
      kind: "historyPage",
      ...page,
      canSend: hasDeliveryTarget(),
    });
  }

  setError(message: string): void {
    this.panel.webview.postMessage({ kind: "error", message });
  }

  setCancelled(message = "Cancelled."): void {
    this.panel.webview.postMessage({ kind: "cancelled", message });
  }

  setNote(message: string): void {
    this.panel.webview.postMessage({ kind: "note", message });
  }

  // Push a delivery-availability change (e.g. after connecting the cloud) into
  // an already-open panel so Send appears without regenerating.
  static updateDelivery(state: { available: boolean; label: string }): void {
    ShiploguePanel.current?.panel.webview.postMessage({ kind: "delivery", ...state });
  }

  showHistoryView(): void {
    if (this.ready) {
      this.panel.webview.postMessage({ kind: "openHistory" });
    } else {
      // The webview may not have booted yet (commands can fire immediately
      // after activation); flush on its "ready" message.
      this.pendingHistory = true;
    }
  }

  private syncDetail(): void {
    this.panel.webview.postMessage({ kind: "init", detail: cfg().detail, tone: cfg().tone });
  }

  private async handle(msg: any): Promise<void> {
    switch (msg.kind) {
      case "copy":
        await vscode.env.clipboard.writeText(msg.text ?? "");
        vscode.window.showInformationMessage(`Copied ${msg.label ?? "text"} to clipboard.`);
        this.callbacks.onCopy?.(
          msg.label === "plain text" ? "plain" : "markdown",
          msg.text ?? "",
          typeof msg.draftId === "string" ? msg.draftId : undefined,
        );
        break;
      case "regenerate":
        this.callbacks.onRegenerate();
        break;
      case "cancel":
        this.callbacks.onCancel?.();
        break;
      case "setDetail": {
        const detail = msg.detail as DetailLevel;
        await this.state.setDetail(detail);
        await vscode.workspace
          .getConfiguration("shiplogue")
          .update("detail", detail, vscode.ConfigurationTarget.Global);
        this.callbacks.onRegenerate();
        break;
      }
      case "setTone": {
        const tone = msg.tone as Tone;
        await this.state.setTone(tone);
        await vscode.workspace
          .getConfiguration("shiplogue")
          .update("tone", tone, vscode.ConfigurationTarget.Global);
        this.callbacks.onRegenerate();
        break;
      }
      case "ready":
        this.ready = true;
        this.syncDetail();
        if (this.pendingHistory) {
          this.pendingHistory = false;
          this.panel.webview.postMessage({ kind: "openHistory" });
        }
        break;
      case "historyOpen":
      case "historyQuery":
        this.callbacks.onHistoryRequest?.(
          typeof msg.query === "string" && msg.query ? { query: msg.query } : {},
        );
        break;
      case "historyMore":
        this.callbacks.onHistoryRequest?.(
          typeof msg.cursor === "string" ? { cursor: msg.cursor } : {},
        );
        break;
      case "restore":
        if (typeof msg.id === "string") {
          this.callbacks.onRestore?.(msg.id);
        }
        break;
      case "sendStored":
        if (typeof msg.id === "string") {
          this.callbacks.onSendStored?.(msg.id);
        }
        break;
      case "feedback":
        if (msg.value === "up" || msg.value === "down") {
          this.callbacks.onFeedback?.(
            msg.value,
            typeof msg.backend === "string" ? msg.backend : "",
          );
        }
        break;
      case "send":
        this.callbacks.onSend?.(
          typeof msg.draftId === "string" ? msg.draftId : undefined,
          typeof msg.markdown === "string" ? msg.markdown : String(msg.text ?? ""),
        );
        break;
      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "shiplogue");
        break;
    }
  }

  dispose(): void {
    ShiploguePanel.current = undefined;
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
