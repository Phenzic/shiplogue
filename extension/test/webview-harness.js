"use strict";
// Minimal DOM + VM sandbox so the real webview client (media/panel.js) can be
// exercised in unit tests: elements are created from the panel template's ids,
// dynamic nodes (preview, history rows) are real node objects, and messages
// flow through the same window.addEventListener('message') path VS Code uses.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PANEL_JS = path.join(__dirname, "..", "media", "panel.js");

function makeNode(tag) {
  const classes = new Set();
  const node = {
    tagName: tag,
    id: "",
    className: "",
    _text: "",
    children: [],
    parentNode: null,
    attrs: {},
    style: {},
    dataset: {},
    listeners: {},
    value: "",
    placeholder: "",
    disabled: false,
    onclick: null,
    onchange: null,
    get textContent() {
      if (this.children.length) {
        return this.children.map((c) => c.textContent).join("");
      }
      return this._text;
    },
    set textContent(v) {
      this._text = v === undefined || v === null ? "" : String(v);
      this.children = [];
    },
    get lastChild() {
      return this.children[this.children.length - 1] || null;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === "class") this.className = String(v);
    },
    getAttribute(k) {
      return this.attrs[k];
    },
    addEventListener(ev, fn) {
      this.listeners[ev] = fn;
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : Boolean(force);
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
    },
  };
  return node;
}

// Build a booted webview from the panel HTML string.
function bootWebview(html, opts = {}) {
  const els = {};
  for (const m of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = makeNode("div");
    node.id = m[1];
    const cls = m[0].match(/class="([^"]*)"/);
    if (cls) {
      cls[1].split(/\s+/).filter(Boolean).forEach((c) => node.classList.add(c));
    }
    els[m[1]] = node;
  }

  const posted = [];
  let windowListener = null;
  const sandbox = {
    document: {
      getElementById: (id) => els[id] || null,
      createElement: (tag) => makeNode(tag),
      createElementNS: (_ns, tag) => makeNode(tag),
      createTextNode: (text) => {
        const n = makeNode("#text");
        n._text = String(text);
        return n;
      },
      querySelectorAll: () => [],
    },
    window: {
      addEventListener: (ev, fn) => {
        if (ev === "message") windowListener = fn;
      },
    },
    acquireVsCodeApi: () => ({
      postMessage: (m) => {
        const copy = JSON.parse(JSON.stringify(m));
        posted.push(copy);
        if (opts.onPost) opts.onPost(copy);
      },
    }),
    console,
    setTimeout,
    clearTimeout,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PANEL_JS, "utf8"), context, { filename: "panel.js" });

  const ui = {
    els,
    posted,
    context,
    hooks: context.window.__shiplogue,
    sendMessage(data) {
      if (!windowListener) throw new Error("webview never registered a message listener");
      windowListener({ data });
    },
    text(id) {
      return (els[id] && els[id].textContent) || "";
    },
    classes(id) {
      const out = [];
      for (const c of ["hidden", "on", "active", "bad", "err"]) {
        if (els[id] && els[id].classList.contains(c)) out.push(c);
      }
      return out;
    },
    visible(id) {
      return !(els[id] && els[id].classList.contains("hidden"));
    },
    click(id) {
      const el = els[id];
      if (!el) throw new Error(`no element #${id}`);
      if (el.onclick) el.onclick({ preventDefault() {} });
      else if (el.listeners.click) el.listeners.click({ preventDefault() {} });
    },
    input(id, value) {
      const el = els[id];
      el.value = value;
      if (el.listeners.input) el.listeners.input({ target: el });
    },
    change(id, value) {
      const el = els[id];
      el.value = value;
      if (el.onchange) el.onchange({ target: el });
    },
  };
  return ui;
}

module.exports = { bootWebview, makeNode };
