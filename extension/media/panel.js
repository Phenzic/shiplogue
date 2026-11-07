/* Shiplogue panel client. Plain browser JS — no build step, no framework.
   Talks to the extension host with postMessage; renders Markdown safely with
   DOM APIs (never innerHTML). */
(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  const state = {
    view: "draft", // draft | history
    mode: "preview", // preview | markdown | plain
    busy: false,
    draft: null,
    txtEdited: false,
    thumbs: null,
    history: { entries: [], cursor: null, query: "", filter: "all", selected: null, canSend: false },
    delivery: { available: false, label: "" },
  };

  /* ---------------- small DOM helpers ---------------- */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function show(node, visible) {
    node.classList.toggle("hidden", !visible);
  }

  /* ---------------- time formatting ---------------- */
  function fmtRelative(ts) {
    const t = Date.parse(ts);
    if (!t) return "";
    const diff = Math.max(0, Date.now() - t);
    const min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + "m ago";
    const h = Math.round(min / 60);
    if (h < 24) return h + "h ago";
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + "d ago";
  }
  function fmtDayHeading(ts) {
    const d = new Date(ts);
    const today = new Date();
    const yday = new Date(Date.now() - 86400000);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, today)) return "Today";
    if (same(d, yday)) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }
  function fmtStamp(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function fmtClock(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------------- markdown → DOM ---------------- */
  // Supports exactly what the generator emits: **Section** headings, bullets,
  // one level of indented sub-bullets, *italic*, **bold**, [text](url) links
  // and the *(inferred)* marker. Everything else is rendered as text.
  function renderMarkdown(container, md, highlights) {
    container.textContent = "";
    const hl = (highlights || []).filter(Boolean);
    let list = null;
    let sublist = null;
    let lastLi = null;

    for (const raw of String(md || "").split("\n")) {
      const line = raw.replace(/\s+$/, "");
      if (!line.trim()) {
        list = null;
        sublist = null;
        lastLi = null;
        continue;
      }
      const section = line.match(/^\*\*([^*]+)\*\*\s*$/);
      if (section) {
        container.appendChild(el("div", "section", section[1]));
        list = null;
        sublist = null;
        lastLi = null;
        continue;
      }
      const sub = line.match(/^\s{2,}- (.*)$/);
      if (sub) {
        if (!list) {
          list = el("ul");
          container.appendChild(list);
        }
        if (!sublist) {
          lastLi = lastLi || el("li");
          if (!lastLi.parentNode) list.appendChild(lastLi);
          sublist = el("ul");
          lastLi.appendChild(sublist);
        }
        const li = el("li");
        inlineNodes(sub[1], hl).forEach((n) => li.appendChild(n));
        sublist.appendChild(li);
        continue;
      }
      const top = line.match(/^- (.*)$/);
      if (top) {
        sublist = null;
        if (!list) {
          list = el("ul");
          container.appendChild(list);
          lastLi = null;
        }
        const li = el("li");
        inlineNodes(top[1], hl).forEach((n) => li.appendChild(n));
        list.appendChild(li);
        lastLi = li;
        continue;
      }
      list = null;
      sublist = null;
      lastLi = null;
      const p = el("p");
      inlineNodes(line, hl).forEach((n) => p.appendChild(n));
      container.appendChild(p);
    }
  }

  function inlineNodes(text, highlights) {
    const out = [];
    const inferred = text.match(/^\*\(inferred\)\*\s*(.*)$/i);
    if (inferred) {
      out.push(el("span", "tag-inferred", "(inferred) "));
      text = inferred[1];
    }
    const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(...textNodes(text.slice(last, m.index), highlights));
      if (m[1] !== undefined) {
        const a = el("a", null, m[1]);
        a.setAttribute("href", m[2]);
        a.setAttribute("rel", "noreferrer");
        out.push(a);
      } else if (m[3] !== undefined) {
        out.push(el("strong", null, m[3]));
      } else {
        out.push(el("em", null, m[4]));
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(...textNodes(text.slice(last), highlights));
    if (out.length === 0) out.push(document.createTextNode(""));
    return out;
  }

  function textNodes(text, highlights) {
    if (!highlights.length) return [document.createTextNode(text)];
    const out = [];
    let rest = text;
    while (rest.length) {
      let hit = null;
      let at = -1;
      for (const h of highlights) {
        const i = rest.indexOf(h);
        if (i !== -1 && (at === -1 || i < at)) {
          at = i;
          hit = h;
        }
      }
      if (!hit) {
        out.push(document.createTextNode(rest));
        break;
      }
      if (at > 0) out.push(document.createTextNode(rest.slice(0, at)));
      out.push(el("mark", "unverified", hit));
      rest = rest.slice(at + hit.length);
    }
    return out;
  }

  // Mirror of format.ts toPlainText — keep in sync.
  function toPlainText(s) {
    return s
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^([ \t]*)[-*•]\s+/gm, "$1• ")
      .trim();
  }

  /* ---------------- draft view rendering ---------------- */
  function setView(view) {
    state.view = view;
    show($("viewDraft"), view === "draft");
    show($("viewHistory"), view === "history");
    $("tabDraft").classList.toggle("active", view === "draft");
    $("tabHistory").classList.toggle("active", view === "history");
    $("tabDraft2").classList.toggle("active", view === "draft");
    $("tabHistory2").classList.toggle("active", view === "history");
    show($("segModes"), view === "draft");
    if (view === "history") {
      vscode.postMessage({ kind: "historyOpen" });
    }
  }

  function setMode(mode) {
    state.mode = mode;
    // The panes use `.pane.on`; `hidden` is a different utility. Mixing them
    // left the editor body blank after switching modes.
    for (const [id, visible] of [
      ["panePreview", mode === "preview"],
      ["paneMd", mode === "markdown"],
      ["paneTxt", mode === "plain"],
    ]) {
      const pane = $(id);
      pane.classList.toggle("on", visible);
      pane.classList.toggle("hidden", !visible);
    }
    $("segMarkdown").classList.toggle("on", mode === "markdown");
    $("segPreview").classList.toggle("on", mode === "preview");
    $("segPlain").classList.toggle("on", mode === "plain");
  }

  function setBusy(busy) {
    state.busy = busy;
    $("regenBtn").disabled = busy;
    $("detail").disabled = busy;
    $("tone").disabled = busy;
    show($("cancelBtn"), busy);
    show($("thumbs"), !busy && !!state.draft);
    if (busy) {
      show($("sendBtn"), false);
      $("copyBtn").disabled = true;
    } else {
      $("copyBtn").disabled = false;
    }
  }

  function setStatus(text, isError) {
    const s = $("statusText");
    s.textContent = text || "";
    s.className = "txt" + (isError ? " err" : "");
  }

  function targetLabel(payload) {
    if (!payload) return "";
    if (payload.sendLabel) return payload.sendLabel;
    if (!payload.target) return "";
    return "Send to " + payload.target;
  }

  function shortFile(path) {
    return String(path).replace(/\\/g, "/").split("/").pop() || String(path);
  }

  function renderStandup(container, doc, highlights) {
    container.textContent = "";
    if (doc.headline) container.appendChild(el("p", "standup-headline", doc.headline));
    const labels = doc.labels || {};
    const section = (label) => {
      const h = el("div", "section", label);
      container.appendChild(h);
    };
    const bullets = (items) => {
      if (!items || !items.length) return;
      const ul = el("ul");
      for (const item of items) {
        const li = el("li");
        inlineNodes(item, highlights || []).forEach((n) => li.appendChild(n));
        ul.appendChild(li);
      }
      container.appendChild(ul);
    };

    section(labels.yesterday || "Yesterday");
    bullets(doc.yesterday);
    section(labels.today || "Today");
    for (const theme of doc.today || []) {
      const row = el("div", "theme");
      const head = el("div", "theme-head");
      head.appendChild(el("span", "tag tag-" + theme.tag, theme.tag));
      head.appendChild(el("span", "theme-title", theme.title));
      row.appendChild(head);
      row.appendChild(el("p", "theme-summary", theme.summary));
      const files = (theme.files || []).map(shortFile);
      const details = (theme.details || []).concat(files);
      if (details.length) {
        const toggle = el("button", "theme-toggle", "Details (" + details.length + ")");
        const body = el("div", "theme-detail hidden");
        const ul = el("ul");
        for (const detail of details) {
          const li = el("li");
          if (files.includes(detail)) li.className = "file";
          li.textContent = detail;
          ul.appendChild(li);
        }
        body.appendChild(ul);
        toggle.onclick = () => {
          const open = body.classList.toggle("hidden");
          toggle.textContent = (open ? "Details" : "Hide details") + " (" + details.length + ")";
        };
        row.appendChild(toggle);
        row.appendChild(body);
      }
      container.appendChild(row);
    }
    section(labels.next || "Next");
    bullets(doc.next);
    section(labels.blockers || "Blockers");
    bullets(doc.blockers);
  }

  function renderMeta(p) {
    const parts = [];
    if (p.projectName) parts.push("[" + p.projectName + "]");
    const s = p.summary || {};
    const c = p.coverage;
    if (c) {
      parts.push(c.git.commits + " commits");
      parts.push(c.git.files + " commit files");
      if (typeof c.git.additions === "number" && typeof c.git.deletions === "number") {
        parts.push("+" + c.git.additions + " / −" + c.git.deletions);
      }
      parts.push(c.ide.touchedFiles + " IDE files");
      parts.push(c.github.items + " GitHub items");
      parts.push(c.agents.sessions + " agent sessions");
      if (c.uncommitted.files) parts.push(c.uncommitted.files + " uncommitted");
    } else {
      if (s.commits) parts.push(s.commits + " commits");
      if (s.files) parts.push(s.files + " files");
      if (s.github) parts.push(s.github + " GitHub items");
    }
    $("metaCounts").textContent = parts.join(" · ");
    $("metaSep").classList.toggle("hidden", !parts.length);

    const v = p.verification;
    const verdict = $("verdict");
    if (v) {
      show(verdict, true);
      verdict.classList.toggle("bad", !!v.needsReview);
      $("verdictLabel").textContent = v.needsReview ? "Needs review" : "Verified";
    } else {
      show(verdict, false);
    }

    if (p.modelLabel) {
      $("modelLabel").textContent = p.modelLabel;
      show($("modelChip"), true);
    } else {
      show($("modelChip"), false);
    }

    if (s.notes && s.notes.length) {
      $("metaCounts").textContent += (parts.length ? " — " : "") + s.notes.join("; ");
    }
  }

  function highlightClaims(p) {
    const v = p.verification;
    if (!v || !v.needsReview || !v.violations) return [];
    return v.violations
      .filter((x) => !/^completion:/.test(x))
      .map((x) => x.replace(/^[a-z]+:\s*/, ""))
      .filter((x) => x && x.length > 1);
  }

  function renderVerify(p) {
    const v = p.verification;
    const strip = $("verifyStrip");
    if (!v) {
      show(strip, false);
      show($("verifyDetails"), false);
      return;
    }
    show(strip, true);
    strip.classList.toggle("bad", !!v.needsReview);
    $("verifyMain").classList.toggle("ok", !v.needsReview);
    const warnSvg = $("verifyIconWarn");
    const okSvg = $("verifyIconOk");
    if (okSvg && warnSvg) {
      okSvg.classList.toggle("hidden", !!v.needsReview);
      warnSvg.classList.toggle("hidden", !v.needsReview);
    }
    if (v.needsReview) {
      $("verifyText").textContent = v.violations.length + " claim" + (v.violations.length === 1 ? "" : "s") + " to check";
      $("verifyRemovals").textContent = "review before sending";
    } else {
      $("verifyText").textContent = v.checkedClaims + " claims verified";
      const extra = [];
      if (v.inferred) extra.push(v.inferred + " inferred");
      if (v.removed) extra.push(v.removed + " removed");
      $("verifyRemovals").textContent = extra.join(" · ");
    }
    // Details list (toggled by the link / badge).
    const details = $("verifyDetails");
    details.textContent = "";
    const rows = [];
    if (v.needsReview && v.violations) {
      for (const viol of v.violations) rows.push("Unverified — " + viol);
    }
    rows.push(v.checkedClaims + " specific claims checked against your activity");
    if (v.inferred) rows.push(v.inferred + " inferred item(s), visibly marked");
    for (const r of rows) details.appendChild(el("div", "detail-row", r));
    details.classList.add("hidden");
  }

  function currentText() {
    if (state.mode === "plain") return $("txt").value;
    return state.draft ? state.draft.markdown : $("md").value;
  }

  function syncPlain() {
    if (!state.txtEdited) $("txt").value = toPlainText($("md").value);
  }

  function renderDraft(p) {
    state.draft = p;
    state.txtEdited = false;
    state.thumbs = null;
    $("thumbUp").classList.remove("on");
    $("thumbDown").classList.remove("on");

    $("md").value = p.markdown || "";
    syncPlain();
    if (p.document) renderStandup($("preview"), p.document, highlightClaims(p));
    else renderMarkdown($("preview"), p.markdown || "", highlightClaims(p));
    renderMeta(p);
    renderVerify(p);

    const sendLabel = targetLabel(p);
    $("sendLabel").textContent = sendLabel || "Send";
    show($("sendBtn"), !!sendLabel && !state.busy);
    show($("thumbs"), !state.busy);

    const stats = p.stats || {};
    const bits = ["Ready"];
    if (p.generatedAt) bits.push("generated " + fmtRelative(p.generatedAt));
    if (stats.durationMs) bits.push(Math.round(stats.durationMs / 1000) + "s");
    if (stats.outputTokens) bits.push(stats.outputTokens.toLocaleString() + " tokens");
    if (p.warnings && p.warnings.length) bits.push(p.warnings.join(" "));
    setStatus(bits.join(" · "), false);

    setView("draft");
  }

  function renderLoading(label) {
    state.draft = null;
    $("md").value = "";
    $("txt").value = "";
    $("md").placeholder = label || "Generating…";
    $("preview").textContent = "";
    const placeholder = el("div", "loading-carousel", "");
    placeholder.appendChild(el("div", "loading-orbit", ""));
    placeholder.appendChild(el("div", "placeholder", label || "Generating…"));
    $("preview").appendChild(placeholder);
    show($("verifyStrip"), false);
    show($("verifyDetails"), false);
    show($("sendBtn"), false);
    show($("modelChip"), false);
    show($("verdict"), false);
    $("metaCounts").textContent = "";
    $("metaSep").classList.add("hidden");
    setStatus(label || "Generating…", false);
  }

  /* ---------------- history ---------------- */
  function filteredEntries() {
    const q = state.history.query.trim().toLowerCase();
    return state.history.entries.filter((e) => {
      if (state.history.filter === "sent" && !(e.sentTo && e.sentTo.length)) return false;
      if (state.history.filter === "copied" && !e.copied) return false;
      if (!q) return true;
      return (e.markdown || "").toLowerCase().includes(q) ||
        String(e.title || "").toLowerCase().includes(q) ||
        String(e.modelLabel || "").toLowerCase().includes(q) ||
        (e.sources || []).some((source) => source.toLowerCase().includes(q));
    });
  }

  function renderHistoryList() {
    const list = $("histList");
    list.textContent = "";
    const entries = filteredEntries();
    const empty = $("histEmpty");
    if (!entries.length) {
      show(empty, true);
      empty.textContent = state.history.query || state.history.filter !== "all"
        ? "No drafts match this search."
        : "No drafts yet. Generate one and it shows up here — drafts are stored locally and kept for a few days (longer once cloud sync is on).";
    } else {
      show(empty, false);
      let day = "";
      for (const e of entries) {
        const heading = fmtDayHeading(e.ts);
        if (heading !== day) {
          day = heading;
          list.appendChild(el("div", "hist-group", heading));
        }
        const item = el("div", "hist-item" + (e.id === state.history.selected ? " on" : ""));
        item.setAttribute("data-id", e.id);
        const t = el("div", "t");
        t.appendChild(document.createTextNode(fmtClock(e.ts)));
        const rel = fmtRelative(e.ts);
        if (!(heading === "Yesterday" && rel === "yesterday")) {
          t.appendChild(el("span", "when", rel));
        }
        item.appendChild(t);
        const m = el("div", "m");
        const sent = e.sentTo && e.sentTo.length;
        m.appendChild(el("span", "dot-s" + (e.needsReview ? " warn" : "")));
        m.appendChild(document.createTextNode(
          e.kind === "weekly"
            ? "Weekly recap"
            : sent ? "Sent" : e.needsReview ? "Needs review" : e.copied ? "Copied" : "Draft",
        ));
        m.appendChild(el("span", "sep", "·"));
        m.appendChild(document.createTextNode(e.detail || "standard"));
        if (e.tone && e.tone !== "neutral") {
          m.appendChild(el("span", "sep", "·"));
          m.appendChild(document.createTextNode(e.tone));
        }
        item.appendChild(m);
        item.addEventListener("click", () => selectHistory(e.id));
        list.appendChild(item);
      }
    }
    show($("histMore"), !!state.history.cursor);
  }

  function selectHistory(id) {
    state.history.selected = id;
    renderHistoryList();
    const e = state.history.entries.find((x) => x.id === id);
    if (!e) return;
    $("histTitle").textContent = e.title || fmtStamp(e.ts);
    const sourceLabels = { vscode: "VS Code", cursor: "Cursor", antigravity: "Antigravity", windsurf: "Windsurf", vscodium: "VSCodium", trae: "Trae", kiro: "Kiro", zed: "Zed", "claude-code": "Claude Code", codex: "Codex", copilot: "GitHub Copilot", github: "GitHub", unknown: "Editor" };
    $("histSub").textContent = [
      (e.sources || []).map((source) => sourceLabels[source] || source).join(" · "),
      e.detail ? e.detail[0].toUpperCase() + e.detail.slice(1) : "",
      e.tone && e.tone !== "neutral" ? e.tone : "",
      e.modelLabel || "",
      e.verification ? (e.verification.needsReview
        ? e.verification.violations.length + " unverified claims"
        : e.verification.checkedClaims + " claims verified") : "",
    ].filter(Boolean).join(" · ");
    if (e.document) renderStandup($("histDraft"), e.document, []);
    else renderMarkdown($("histDraft"), e.markdown || "", highlightClaims(e));
    show($("histFoot"), true);
    const sent = e.sentTo && e.sentTo.length;
    $("histSent").textContent = sent ? "Sent to " + e.sentTo.join(", ") : e.copied ? "Copied" : "Not sent";
    $("histRestore").disabled = false;
    $("histCopy").disabled = false;
    $("histSend").disabled = false;
    show($("histSend"), !!state.history.canSend);
  }

  function historyMessage(m) {
    if (!m.append) {
      state.history.entries = m.entries || [];
    } else {
      state.history.entries = state.history.entries.concat(m.entries || []);
    }
    state.history.cursor = m.cursor || null;
    state.history.canSend = !!m.canSend;
    const selectedExists = state.history.entries.some((e) => e.id === state.history.selected);
    if (!selectedExists) {
      state.history.selected = state.history.entries.length ? state.history.entries[0].id : null;
    }
    renderHistoryList();
    if (state.history.selected) selectHistory(state.history.selected);
    else {
      $("histTitle").textContent = "Select a draft";
      $("histSub").textContent = "";
      $("histDraft").textContent = "";
      $("histDraft").appendChild(el("div", "placeholder", "Pick a draft on the left to preview it."));
      show($("histFoot"), false);
    }
  }

  /* ---------------- wiring ---------------- */
  $("tabDraft").onclick = () => setView("draft");
  $("tabDraft2").onclick = () => setView("draft");
  $("tabHistory").onclick = () => setView("history");
  $("tabHistory2").onclick = () => setView("history");
  $("historyBtn").onclick = () => setView("history");

  $("segMarkdown").onclick = () => setMode("markdown");
  $("segPreview").onclick = () => setMode("preview");
  $("segPlain").onclick = () => setMode("plain");
  $("segMarkdown").classList.add("on");

  $("md").addEventListener("input", () => {
    syncPlain();
    renderMarkdown($("preview"), $("md").value, []);
  });
  $("txt").addEventListener("input", () => {
    state.txtEdited = true;
  });

  $("copyBtn").onclick = () =>
    vscode.postMessage({
      kind: "copy",
      text: currentText(),
      label: state.mode === "plain" ? "plain text" : "markdown",
      draftId: state.draft ? state.draft.draftId : undefined,
    });
  $("sendBtn").onclick = () =>
    vscode.postMessage({
      kind: "send",
      text: $("md").value,
      markdown: $("md").value,
      draftId: state.draft ? state.draft.draftId : undefined,
    });
  $("regenBtn").onclick = () => vscode.postMessage({ kind: "regenerate" });
  $("cancelBtn").onclick = () => vscode.postMessage({ kind: "cancel" });
  $("detail").onchange = (e) => vscode.postMessage({ kind: "setDetail", detail: e.target.value });
  $("tone").onchange = (e) => vscode.postMessage({ kind: "setTone", tone: e.target.value });
  $("settingsBtn").onclick = () => vscode.postMessage({ kind: "openSettings" });

  $("thumbUp").onclick = () => {
    state.thumbs = "up";
    $("thumbUp").classList.add("on");
    $("thumbDown").classList.remove("on");
    vscode.postMessage({ kind: "feedback", value: "up", backend: $("modelLabel").textContent || "" });
  };
  $("thumbDown").onclick = () => {
    state.thumbs = "down";
    $("thumbDown").classList.add("on");
    $("thumbUp").classList.remove("on");
    vscode.postMessage({ kind: "feedback", value: "down", backend: $("modelLabel").textContent || "" });
  };

  const toggleDetails = () => {
    const d = $("verifyDetails");
    d.classList.toggle("hidden");
  };
  $("verifyLink").onclick = (e) => {
    e.preventDefault();
    toggleDetails();
  };
  $("verdict").onclick = (e) => {
    e.preventDefault();
    toggleDetails();
  };

  // history controls
  let searchTimer = null;
  $("histSearch").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.history.query = e.target.value || "";
      vscode.postMessage({ kind: "historyQuery", query: state.history.query });
    }, 250);
  });
  $("filterAll").onclick = () => {
    state.history.filter = "all";
    renderHistoryList();
  };
  $("filterSent").onclick = () => {
    state.history.filter = "sent";
    renderHistoryList();
  };
  $("filterCopied").onclick = () => {
    state.history.filter = "copied";
    renderHistoryList();
  };
  $("histMore").onclick = () =>
    vscode.postMessage({ kind: "historyMore", cursor: state.history.cursor });
  $("histCopy").onclick = () => {
    const e = state.history.entries.find((x) => x.id === state.history.selected);
    if (e) vscode.postMessage({ kind: "copy", text: e.markdown || "", label: "markdown", draftId: e.id });
  };
  $("histRestore").onclick = () =>
    vscode.postMessage({ kind: "restore", id: state.history.selected });
  $("histSend").onclick = () =>
    vscode.postMessage({ kind: "syncStored", id: state.history.selected });

  window.addEventListener("message", (event) => {
    const m = event.data || {};
    switch (m.kind) {
      case "init":
      case "draft":
        if (m.kind === "draft") {
          setBusy(false);
          renderDraft(m);
        }
        if (m.detail) $("detail").value = m.detail;
        if (m.tone) $("tone").value = m.tone;
        break;
      case "loading":
        setBusy(true);
        renderLoading(m.label);
        break;
      case "error":
        setBusy(false);
        setStatus(m.message, true);
        break;
      case "cancelled":
        setBusy(false);
        setStatus(m.message || "Cancelled.", false);
        break;
      case "historyPage":
        historyMessage(m);
        break;
      case "openHistory":
        setView("history");
        break;
      case "note":
        setStatus(m.message, false);
        break;
      case "delivery":
        state.delivery = { available: !!m.available, label: m.label || "" };
        if (state.draft) {
          $("sendLabel").textContent = state.delivery.label || "Send";
          show($("sendBtn"), state.delivery.available && !state.busy);
        }
        state.history.canSend = state.delivery.available;
        break;
      case "historyEmpty":
        state.history.entries = [];
        state.history.cursor = null;
        renderHistoryList();
        break;
    }
  });

  // Test hooks (no-op in production).
  window.__shiplogue = { renderMarkdown, toPlainText, fmtRelative, state, setView, setMode };

  setMode("preview");
  setView("draft");
  // Tell the host the listener is wired; messages sent before this are lost.
  vscode.postMessage({ kind: "ready" });
})();
