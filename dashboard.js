/**
 * Preserve Vault — Full Dashboard
 */

// ── Helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

let toastTimer = null;
function toast(msg, type = "ok", ms = 2400) {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

async function sendToTab(msg) {
  return new Promise(res => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]?.id) return res(null);
      chrome.tabs.sendMessage(tabs[0].id, msg, resp => {
        if (chrome.runtime.lastError) res(null);
        else res(resp);
      });
    });
  });
}

async function sendToBg(msg) {
  return new Promise(res => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) res(null);
      else res(resp);
    });
  });
}

function timeAgo(ms) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5)  return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function formatDate(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function labelFromKey(key) {
  const parts = key.split("::");
  if (parts.length < 3) return key;
  const ident = parts.slice(2).join("::");
  const ph   = ident.match(/\[ph="([^"]+)"\]/);   if (ph)   return ph[1];
  const aria = ident.match(/\[aria="([^"]+)"\]/); if (aria) return aria[1];
  const name = ident.match(/\[name="([^"]+)"\]/); if (name) return name[1];
  const id   = ident.match(/#([\w-]+)/);          if (id)   return `#${id[1]}`;
  return ident.replace(/\[i\d+\]/, "").trim() || "Unknown field";
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function bytesToKB(n) {
  if (n < 1024) return `${n} B`;
  return `${(n/1024).toFixed(1)} KB`;
}

// ── Theme ──────────────────────────────────────────────────────
function initTheme() {
  const t = localStorage.getItem("pv-theme") || "light";
  applyTheme(t);
}

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("ico-moon").style.display = t === "light" ? "" : "none";
  $("ico-sun").style.display  = t === "dark"  ? "" : "none";
  $("theme-label").textContent = t === "light" ? "Dark mode" : "Light mode";
  localStorage.setItem("pv-theme", t);
}

$("btn-theme").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  applyTheme(cur === "dark" ? "light" : "dark");
});

// ── Navigation ─────────────────────────────────────────────────
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-section").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${tab}`).classList.add("active");
    if (tab === "drafts") loadDrafts();
    if (tab === "fields") loadFields();
    if (tab === "settings") loadSettings();
  });
});

// ── OVERVIEW ───────────────────────────────────────────────────
async function loadOverview() {
  // Current tab
  const tabs = await new Promise(res => chrome.tabs.query({ active: true, currentWindow: true }, res));
  const tab  = tabs[0];
  let hostname = "—";
  if (tab?.url) {
    try { hostname = new URL(tab.url).hostname; } catch {}
  }
  $("current-page-url").textContent = hostname;
  $("page-hostname").textContent = hostname || "No active page";

  // Content script
  const status = await sendToTab({ type: "GET_STATUS" });
  if (status) {
    const n = status.fieldCount || 0;
    $("stat-fields").textContent = n;
    $("protect-title").textContent = "Fully Protected";
    $("protect-sub").textContent = `Monitoring ${n} field${n !== 1 ? "s" : ""}`;
    $("status-badge").className = "status-badge active";
    $("status-badge").innerHTML = '<span class="dot"></span> Active';
  } else {
    $("stat-fields").textContent = "—";
    $("protect-title").textContent = "Not Active";
    $("protect-sub").textContent = "No content script on this page";
    const pi = document.querySelector(".protect-icon");
    if (pi) { pi.classList.remove("green"); pi.classList.add("red"); }
    $("status-badge").className = "status-badge inactive";
    $("status-badge").innerHTML = '<span class="dot"></span> Inactive';
  }

  // Background stats
  const stats = await sendToBg({ type: "GET_STATS" });
  if (stats) {
    $("stat-drafts").textContent   = stats.drafts    ?? "0";
    $("stat-restored").textContent = stats.restored  ?? "0";
    $("stat-storage").textContent  = bytesToKB(stats.storageBytes || 0);
    $("last-activity").textContent = timeAgo(stats.lastActivity);
    $("nav-drafts-count").textContent = stats.drafts || 0;
    if (stats.drafts > 0) $("nav-drafts-count").classList.add("show");
  }
}

// ── Overview buttons ───────────────────────────────────────────
$("btn-save-now").addEventListener("click", async () => {
  const resp = await sendToTab({ type: "SAVE_NOW" });
  if (resp?.success) { toast("✓ Saved successfully!"); loadOverview(); }
  else toast("Could not save — reload the page", "err");
});

$("btn-restore").addEventListener("click", async () => {
  const resp = await sendToTab({ type: "RESTORE_NOW" });
  if (resp?.success) toast("Checking for saved drafts…");
  else toast("No content script on this page", "err");
});

$("btn-clear-page").addEventListener("click", async () => {
  const tabs = await new Promise(res => chrome.tabs.query({ active: true, currentWindow: true }, res));
  const tab = tabs[0];
  if (!tab?.url) return toast("Could not get page URL", "err");
  let url;
  try { url = new URL(tab.url).href.split("?")[0]; } catch { return toast("Invalid URL", "err"); }
  if (!confirm("Clear all saved drafts for this page?")) return;
  const resp = await sendToBg({ type: "CLEAR_PAGE", url });
  if (resp) { toast(resp.removed > 0 ? `✓ Cleared ${resp.removed} draft(s)` : "No drafts for this page"); loadOverview(); }
});

$("btn-clear-all").addEventListener("click", async () => {
  if (!confirm("Clear ALL saved drafts across ALL websites? This cannot be undone.")) return;
  const resp = await sendToBg({ type: "CLEAR_ALL" });
  if (resp) { toast(`✓ Cleared ${resp.removed} draft(s)`); loadOverview(); }
});

// ── DRAFTS ─────────────────────────────────────────────────────
let allDrafts = [];

// Search + sort listeners
$("drafts-search").addEventListener("input", renderDrafts);
$("drafts-sort").addEventListener("change",  renderDrafts);

async function loadDrafts() {
  const list = $("drafts-list");
  list.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="empty-title">Loading…</div></div>`;

  const [bgResp, lsResp] = await Promise.all([
    sendToBg({ type: "GET_ALL_DRAFTS" }),
    sendToTab({ type: "GET_LS_DRAFTS" }),
  ]);

  const merged = {};
  if (bgResp?.drafts) bgResp.drafts.forEach(({ key, entry }) => { merged[key] = entry; });
  if (lsResp?.drafts) Object.entries(lsResp.drafts).forEach(([k, e]) => { if (e && k.startsWith("ws::")) merged[k] = e; });

  allDrafts = Object.entries(merged)
    .filter(([, e]) => e?.value)
    .map(([key, entry]) => ({ key, entry }));

  $("nav-drafts-count").textContent = allDrafts.length;
  if (allDrafts.length > 0) $("nav-drafts-count").classList.add("show");

  renderDrafts();
}

function renderDrafts() {
  const list   = $("drafts-list");
  const query  = ($("drafts-search")?.value || "").toLowerCase();
  const sort   = $("drafts-sort")?.value || "newest";

  let filtered = allDrafts.filter(({ key, entry }) => {
    if (!query) return true;
    const text = `${entry.value || ""} ${entry.hostname || ""} ${labelFromKey(key)}`.toLowerCase();
    return text.includes(query);
  });

  if (sort === "newest") filtered.sort((a, b) => (b.entry.savedAt||0) - (a.entry.savedAt||0));
  if (sort === "oldest") filtered.sort((a, b) => (a.entry.savedAt||0) - (b.entry.savedAt||0));
  if (sort === "alpha")  filtered.sort((a, b) => (a.entry.value||"").localeCompare(b.entry.value||""));

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>
      <div class="empty-title">${allDrafts.length === 0 ? "No drafts yet" : "No results"}</div>
      <div class="empty-desc">${allDrafts.length === 0 ? "Your drafts will appear here automatically as you type on any website" : "Try a different search term"}</div>
    </div>`;
    return;
  }

  list.innerHTML = "";
  filtered.forEach(({ key, entry }) => buildDraftCard(list, key, entry));
}

function buildDraftCard(list, key, entry) {
  let hostname = "—";
  try { hostname = new URL(entry.url||"").hostname; } catch { hostname = entry.hostname || "—"; }

  const fieldLabel = labelFromKey(key);
  const chars = (entry.value||"").length;

  const card = document.createElement("div");
  card.className = "draft-card";
  card.dataset.key = key;

  card.innerHTML = `
    <div class="draft-body">
      <div class="draft-top">
        <div class="draft-meta">
          <div class="draft-site" title="${escHtml(entry.url||'')}">${escHtml(hostname)}</div>
          <div class="draft-field">${escHtml(fieldLabel)}</div>
        </div>
        <span class="draft-chip">Saved</span>
      </div>
      <div class="draft-preview">${escHtml(entry.value||"")}</div>
      <div class="draft-footer">
        <div class="draft-footer-meta">
          <span class="draft-time">${entry.savedAt ? formatDate(entry.savedAt) : "—"}</span>
          <span class="draft-chars">${chars} chars</span>
        </div>
      </div>
    </div>

    <div class="draft-editor" id="editor-${key.replace(/[^a-z0-9]/gi,'_')}">
      <textarea class="editor-ta" rows="4">${escHtml(entry.value||"")}</textarea>
      <div class="editor-foot">
        <span class="editor-auto"></span>
        <button class="editor-save">Save Changes</button>
      </div>
    </div>

    <div class="draft-actions-bar">
      <button class="da-btn restore" data-action="restore">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z"/></svg>
        Restore
      </button>
      <button class="da-btn" data-action="preview">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
        Preview
      </button>
      <button class="da-btn" data-action="edit">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        Edit
      </button>
      <button class="da-btn del" data-action="delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2.46-7.12l1.41-1.41L12 12.59l2.12-2.12 1.41 1.41L13.41 14l2.12 2.12-1.41 1.41L12 15.41l-2.12 2.12-1.41-1.41L10.59 14l-2.13-2.12zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>
        Delete
      </button>
    </div>`;

  // Wire actions
  card.querySelectorAll(".da-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const a = btn.dataset.action;
      if (a === "restore") draftRestore(key, entry);
      if (a === "preview") draftPreview(key, entry, hostname);
      if (a === "edit")    draftEdit(card);
      if (a === "delete")  draftDelete(key, card);
    });
  });

  // Editor auto-save
  const ta      = card.querySelector(".editor-ta");
  const saveBtn = card.querySelector(".editor-save");
  const autoLbl = card.querySelector(".editor-auto");
  let autoTimer = null;

  ta.addEventListener("input", () => {
    autoLbl.textContent = "Unsaved…";
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => doSaveEdit(key, entry, ta, autoLbl, card), 2000);
  });

  saveBtn.addEventListener("click", () => {
    clearTimeout(autoTimer);
    doSaveEdit(key, entry, ta, autoLbl, card);
  });

  list.appendChild(card);
}

async function draftRestore(key, entry) {
  const resp = await sendToTab({ type: "RESTORE_SPECIFIC", key, value: entry.value });
  if (resp?.success) toast("✓ Draft restored to the page!");
  else toast("Switch to the target tab first, then restore", "err");
}

function draftPreview(key, entry, hostname) {
  $("preview-meta").textContent = `${hostname} · ${labelFromKey(key)} · ${entry.savedAt ? formatDate(entry.savedAt) : ""}`;
  $("preview-body").textContent = entry.value || "";
  $("preview-chars").textContent = `${(entry.value||"").length} characters`;
  $("preview-modal").classList.remove("hidden");
  $("preview-restore").onclick = () => {
    draftRestore(key, entry);
    $("preview-modal").classList.add("hidden");
  };
}

function draftEdit(card) {
  const editor = card.querySelector(".draft-editor");
  const isOpen = editor.classList.contains("open");
  document.querySelectorAll(".draft-editor.open").forEach(e => e.classList.remove("open"));
  if (!isOpen) editor.classList.add("open");
}

async function draftDelete(key, card) {
  await Promise.all([
    sendToBg({ type: "CLEAR_KEYS", keys: [key] }),
    sendToTab({ type: "CLEAR_LS_KEYS", keys: [key] }),
  ]);
  card.style.transition = "opacity .2s, transform .2s";
  card.style.opacity = "0";
  card.style.transform = "translateY(-4px)";
  setTimeout(() => card.remove(), 200);
  allDrafts = allDrafts.filter(d => d.key !== key);
  $("nav-drafts-count").textContent = allDrafts.length;
  toast("Draft deleted");
  if (allDrafts.length === 0) renderDrafts();
}

async function doSaveEdit(key, entry, ta, autoLbl, card) {
  const updated = { ...entry, value: ta.value, savedAt: Date.now() };
  await Promise.all([
    sendToBg({ type: "UPDATE_DRAFT", key, entry: updated }),
    sendToTab({ type: "UPDATE_LS_DRAFT", key, entry: updated }),
  ]);
  const idx = allDrafts.findIndex(d => d.key === key);
  if (idx !== -1) allDrafts[idx].entry = updated;
  const prev = card.querySelector(".draft-preview");
  if (prev) prev.textContent = ta.value;
  autoLbl.textContent = "✓ Saved";
  setTimeout(() => { autoLbl.textContent = ""; }, 2000);
}

// ── FIELDS ─────────────────────────────────────────────────────
async function loadFields() {
  const list = $("fields-list");
  list.innerHTML = `<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="7" y1="8" x2="17" y2="8"/></svg></div><div class="empty-title">Scanning…</div></div>`;

  const resp = await sendToTab({ type: "GET_FIELDS_DETAIL" });

  if (!resp?.fields?.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg></div>
      <div class="empty-title">No fields found</div>
      <div class="empty-desc">No trackable text inputs on the active tab.<br>Switch to a page with form fields and click Refresh.</div>
    </div>`;
    $("nav-fields-count").classList.remove("show");
    return;
  }

  $("nav-fields-count").textContent = resp.fields.length;
  $("nav-fields-count").classList.add("show");

  list.innerHTML = "";
  resp.fields.forEach(f => {
    const typeClass = f.type === "textarea" ? "chip-textarea" : f.type === "editable" ? "chip-rich" : "chip-input";
    const typeLabel = f.type === "textarea" ? "Textarea" : f.type === "editable" ? "Rich Text" : "Input";
    const div = document.createElement("div");
    div.className = "field-card";
    div.innerHTML = `
      <div class="field-top">
        <span class="field-type-chip ${typeClass}">${typeLabel}</span>
        <span class="field-name">${escHtml(f.label || "Unlabelled")}</span>
      </div>
      <div class="field-val ${f.value ? "filled" : ""}">
        ${f.value ? `"${escHtml(f.value.slice(0,80))}${f.value.length>80?"…":""}"` : "Empty"}
      </div>`;
    list.appendChild(div);
  });
}

$("btn-refresh-fields").addEventListener("click", loadFields);

// ── SETTINGS ───────────────────────────────────────────────────
const DEFAULT_SETTINGS = { autosave: true, formdetect: true, notifs: true, crash: true };

async function loadSettings() {
  const resp = await sendToBg({ type: "GET_SETTINGS" });
  const s = resp?.settings || DEFAULT_SETTINGS;
  ["autosave","formdetect","notifs","crash"].forEach(k => {
    const el = $(`toggle-${k}`);
    if (el) el.checked = s[k] !== undefined ? s[k] : true;
  });
}

["autosave","formdetect","notifs","crash"].forEach(k => {
  const el = $(`toggle-${k}`);
  if (!el) return;
  el.addEventListener("change", async () => {
    const cur = await new Promise(res =>
      chrome.storage.local.get("ws-settings", d => res(d["ws-settings"] || DEFAULT_SETTINGS))
    );
    cur[k] = el.checked;
    chrome.storage.local.set({ "ws-settings": cur });
    toast(el.checked ? `${settingLabel(k)} enabled` : `${settingLabel(k)} disabled`);
  });
});

function settingLabel(k) {
  return { autosave:"Auto Save", formdetect:"Form Detection", notifs:"Notifications", crash:"Crash Protection" }[k] || k;
}

$("settings-clear-page").addEventListener("click", async () => {
  const tabs = await new Promise(res => chrome.tabs.query({ active: true, currentWindow: true }, res));
  const tab = tabs[0];
  if (!tab?.url) return toast("Could not get page URL", "err");
  let url;
  try { url = new URL(tab.url).href.split("?")[0]; } catch { return toast("Invalid URL", "err"); }
  if (!confirm("Clear all drafts for this page?")) return;
  const resp = await sendToBg({ type: "CLEAR_PAGE", url });
  toast(resp?.removed > 0 ? `✓ Cleared ${resp.removed} draft(s)` : "No drafts for this page");
});

$("settings-clear-all").addEventListener("click", async () => {
  if (!confirm("Clear ALL saved drafts? This cannot be undone.")) return;
  const resp = await sendToBg({ type: "CLEAR_ALL" });
  toast(`✓ Cleared ${resp?.removed || 0} draft(s)`);
  allDrafts = [];
});

// ── MODAL ──────────────────────────────────────────────────────
$("modal-close").addEventListener("click", () => $("preview-modal").classList.add("hidden"));
$("modal-bg").addEventListener("click",    () => $("preview-modal").classList.add("hidden"));

// ── INIT ───────────────────────────────────────────────────────
initTheme();
loadOverview();

// Handle hash navigation (#drafts, #settings, #fields)
const hash = location.hash.replace("#", "");
if (["drafts","fields","settings"].includes(hash)) {
  const navBtn = document.querySelector(`.nav-item[data-tab="${hash}"]`);
  if (navBtn) navBtn.click();
}
