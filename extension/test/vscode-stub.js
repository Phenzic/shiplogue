"use strict";
// Minimal, controllable stand-in for the `vscode` module so the compiled
// extension can run under plain Node in tests. Only the surface this extension
// actually touches is implemented. State lives on `stub` and is reset between
// tests via stub.reset().
const path = require("path");

const stub = {
  config: {},
  folders: [],
  notifications: [],
  errors: [],
  clipboard: "",
  panels: [],
  documents: [],
  shownDocs: [],
  inputBoxes: [],
  inputAnswers: [],
  infoAnswers: [],
  warningAnswers: [],
  quickPicks: [],
  quickPickAnswers: [],
  openedUrls: [],
  terminals: [],
  sessions: {},
  authCalls: [],
  configUpdates: [],
  saveListeners: [],
  changeListeners: [],
  disposeCount: 0,
  secrets: {},
  commandRegistry: new Map(),

  reset() {
    this.config = {};
    this.folders = [];
    this.notifications = [];
    this.errors = [];
    this.clipboard = "";
    this.panels = [];
    this.documents = [];
    this.shownDocs = [];
    this.inputBoxes = [];
    this.inputAnswers = [];
    this.infoAnswers = [];
    this.warningAnswers = [];
    this.quickPicks = [];
    this.quickPickAnswers = [];
    this.openedUrls = [];
    this.terminals = [];
    this.sessions = {};
    this.authCalls = [];
    this.configUpdates = [];
    this.saveListeners = [];
    this.changeListeners = [];
    this.disposeCount = 0;
    this.secrets = {};
    this.commandRegistry.clear();
  },

  // Merge settings, e.g. { "standup.ollama.model": "test" }.
  setConfig(obj) {
    this.config = { ...this.config, ...obj };
  },

  setFolders(list) {
    this.folders = list.map((f) => ({
      name: f.name,
      index: 0,
      uri: { scheme: "file", fsPath: f.fsPath, path: f.fsPath, toString: () => `file://${f.fsPath}` },
    }));
  },

  makeDoc(fsPath, opts = {}) {
    return {
      uri: {
        scheme: opts.scheme ?? "file",
        fsPath,
        path: fsPath,
        toString: () => `${opts.scheme ?? "file"}://${fsPath}`,
      },
      fileName: fsPath,
      languageId: opts.languageId ?? "typescript",
      isUntitled: opts.isUntitled ?? false,
      getText: () => opts.text ?? "",
    };
  },

  emitSave(doc) {
    this.saveListeners.forEach((fn) => fn(doc));
  },
  emitChange(doc) {
    this.changeListeners.forEach((fn) => fn({ document: doc, contentChanges: [] }));
  },
  // Number of live listeners; used to verify dispose() actually unsubscribes.
  listenerCount() {
    return this.saveListeners.length + this.changeListeners.length;
  },
};

function disposable(fn) {
  return {
    dispose() {
      stub.disposeCount++;
      if (fn) fn();
    },
  };
}

function getConfiguration(section) {
  const full = (key) => (section ? `${section}.${key}` : key);
  return {
    get(key, def) {
      const v = stub.config[full(key)];
      return v === undefined ? def : v;
    },
    inspect(key) {
      const v = stub.config[full(key)];
      return { key: full(key), globalValue: v, workspaceValue: undefined, defaultValue: undefined };
    },
    update(key, value, _target) {
      stub.config[full(key)] = value;
      stub.configUpdates.push({ key: full(key), value, target: _target });
      return Promise.resolve();
    },
  };
}

const workspace = {
  get workspaceFolders() {
    return stub.folders.length ? stub.folders : undefined;
  },
  getConfiguration,
  getWorkspaceFolder(uri) {
    const p = uri.fsPath;
    return stub.folders.find((f) => p === f.uri.fsPath || p.startsWith(f.uri.fsPath + path.sep));
  },
  asRelativePath(uriOrPath, includeWorkspaceFolder) {
    const p = typeof uriOrPath === "string" ? uriOrPath : uriOrPath.fsPath;
    const folder = workspace.getWorkspaceFolder({ fsPath: p });
    if (!folder) return p;
    const rel = path.relative(folder.uri.fsPath, p);
    return includeWorkspaceFolder ? `${folder.name}/${rel}` : rel;
  },
  onDidSaveTextDocument(cb) {
    stub.saveListeners.push(cb);
    return disposable(() => {
      stub.saveListeners = stub.saveListeners.filter((x) => x !== cb);
    });
  },
  onDidChangeTextDocument(cb) {
    stub.changeListeners.push(cb);
    return disposable(() => {
      stub.changeListeners = stub.changeListeners.filter((x) => x !== cb);
    });
  },
  onDidChangeConfiguration() {
    return disposable();
  },
  openTextDocument(opts) {
    const doc = {
      uri: { scheme: "untitled", fsPath: "", toString: () => "untitled:standup-activity" },
      languageId: opts.language ?? "plaintext",
      fileName: "untitled",
      isUntitled: true,
      getText: () => opts.content ?? "",
    };
    stub.documents.push(doc);
    return Promise.resolve(doc);
  },
};

function makePanel(viewType, title, column, options) {
  const panel = {
    viewType,
    title,
    column,
    options,
    visible: true,
    disposed: false,
    messages: [],
    messageHandler: undefined,
    webview: {
      html: "",
      cspSource: "",
      asWebviewUri: (u) => u,
      postMessage(msg) {
        panel.messages.push(msg);
        return Promise.resolve(true);
      },
      onDidReceiveMessage(cb) {
        panel.messageHandler = cb;
        return disposable();
      },
    },
    onDidDispose(cb) {
      panel._disposeCb = cb;
      return disposable();
    },
    onDidChangeViewState() {
      return disposable();
    },
    reveal() {
      panel.visible = true;
    },
    dispose() {
      if (panel.disposed) return;
      panel.disposed = true;
      if (panel._disposeCb) panel._disposeCb();
    },
  };
  stub.panels.push(panel);
  return panel;
}

const window = {
  createWebviewPanel: (viewType, title, column, options) =>
    makePanel(viewType, title, column, options),
  showInformationMessage(msg, ...items) {
    stub.notifications.push({ message: msg, items });
    return Promise.resolve(stub.infoAnswers.shift());
  },
  showErrorMessage(msg, ...items) {
    stub.errors.push({ message: msg, items });
    return Promise.resolve(undefined);
  },
  showWarningMessage(msg, ...items) {
    stub.notifications.push({ message: msg, items, warning: true });
    return Promise.resolve(stub.warningAnswers.shift());
  },
  showInputBox(opts) {
    stub.inputBoxes.push(opts);
    return Promise.resolve(stub.inputAnswers.shift());
  },
  showQuickPick(items, opts) {
    stub.quickPicks.push({ items, opts });
    return Promise.resolve(stub.quickPickAnswers.shift());
  },
  createTerminal(name) {
    const term = {
      name,
      sent: [],
      shown: false,
      show() {
        this.shown = true;
      },
      sendText(text) {
        this.sent.push(text);
      },
      dispose() {},
    };
    stub.terminals.push(term);
    return term;
  },
  showTextDocument(doc) {
    stub.shownDocs.push(doc);
    return Promise.resolve({ document: doc });
  },
  withProgress(_opts, task) {
    return task({ report() {} }, { isCancellationRequested: false });
  },
};

const commands = {
  registerCommand(id, fn) {
    stub.commandRegistry.set(id, fn);
    return disposable(() => stub.commandRegistry.delete(id));
  },
  executeCommand(id, ...args) {
    const fn = stub.commandRegistry.get(id);
    if (!fn) return Promise.reject(new Error(`command not found: ${id}`));
    return Promise.resolve(fn(...args));
  },
};

const authentication = {
  getSession(provider, scopes, options) {
    stub.authCalls.push({ provider, scopes, options });
    const token = stub.sessions[provider];
    return Promise.resolve(
      token ? { accessToken: token, id: "test-session", account: { id: "u", label: "tester" } } : undefined,
    );
  },
};

const env = {
  clipboard: {
    writeText(text) {
      stub.clipboard = text;
      return Promise.resolve();
    },
    readText() {
      return Promise.resolve(stub.clipboard);
    },
  },
  openExternal(uri) {
    stub.openedUrls.push(uri && uri.toString ? uri.toString() : String(uri));
    return Promise.resolve(true);
  },
};

module.exports = {
  stub,
  workspace,
  window,
  commands,
  authentication,
  env,
  Uri: {
    file(fsPath) {
      return { scheme: "file", fsPath, path: fsPath, toString: () => `file://${fsPath}` };
    },
    parse(s) {
      return { scheme: s.split(":")[0], path: s, toString: () => s };
    },
  },
  ViewColumn: { Active: -1, Beside: -2, One: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  Disposable: class Disposable {
    constructor(fn) {
      this._fn = fn;
    }
    dispose() {
      if (this._fn) this._fn();
    }
  },
};
