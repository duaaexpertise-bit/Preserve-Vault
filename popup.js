/**
 * Preserve Vault — Compact Popup (Quick Access)
 */

// ── Helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

let toastTimer = null;
function toast(msg, type = "ok", ms = 2200) {
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

// ── Theme ──────────────────────────────────────────────────────
(function initTheme() {
  const t = localStorage.getItem("pv-theme") || "light";
  applyTheme(t);
})();

function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  $("ico-moon").style.display = t === "light" ? "" : "none";
  $("ico-sun").style.display  = t === "dark"  ? "" : "none";
  localStorage.setItem("pv-theme", t);
}

$("btn-theme").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  applyTheme(cur === "dark" ? "light" : "dark");
});

// ── Load all data ──────────────────────────────────────────────
async function loadAll() {
  // 1. Current tab info
  const tabs = await new Promise(res => chrome.tabs.query({ active: true, currentWindow: true }, res));
  const tab  = tabs[0];

  // 2. Content script status
  const status = await sendToTab({ type: "GET_STATUS" });

  if (status) {
    const n = status.fieldCount || 0;
    $("protect-title").textContent = "Fully Protected";
    $("protect-sub").textContent   = `Monitoring ${n} field${n !== 1 ? "s" : ""}${status.hostname ? " · " + status.hostname : ""}`;
    $("stat-fields").textContent = n;
    $("status-text").textContent = "Active";
    $("status-pill").className   = "status-pill active";
  } else {
    $("protect-title").textContent = "Not Active";
    $("protect-sub").textContent   = "Open a page with text fields";
    $("protect-icon-wrap")?.classList.add("inactive");
    $("stat-fields").textContent = "—";
    $("status-text").textContent = "Inactive";
    $("status-pill").className   = "status-pill inactive";
    const iconWrap = document.querySelector(".protect-icon-wrap");
    if (iconWrap) iconWrap.classList.add("inactive");
  }

  // 3. Background stats
  const stats = await sendToBg({ type: "GET_STATS" });
  if (stats) {
    $("stat-drafts").textContent   = stats.drafts   ?? "0";
    $("stat-restored").textContent = stats.restored ?? "0";
  }

  // 4. Last saved draft
  const [bgResp, lsResp] = await Promise.all([
    sendToBg({ type: "GET_ALL_DRAFTS" }),
    sendToTab({ type: "GET_LS_DRAFTS" }),
  ]);

  const merged = {};
  if (bgResp?.drafts) bgResp.drafts.forEach(({ key, entry }) => { merged[key] = entry; });
  if (lsResp?.drafts) Object.entries(lsResp.drafts).forEach(([k, e]) => { if (e && k.startsWith("ws::")) merged[k] = e; });

  const all = Object.entries(merged)
    .filter(([, e]) => e?.value)
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => (b.entry.savedAt || 0) - (a.entry.savedAt || 0));

  if (all.length > 0) {
    const last = all[0].entry;
    let host = "Unknown";
    try { host = new URL(last.url || "").hostname; } catch { host = last.hostname || "—"; }

    $("last-draft-card").classList.remove("hidden");
    $("no-draft-msg").style.display   = "none";
    $("last-site").textContent = host;
    $("last-time").textContent = timeAgo(last.savedAt);
    $("last-text").textContent = `"${(last.value || "").slice(0, 70)}${(last.value || "").length > 70 ? "…" : ""}"`;

    // Wire restore-last to the actual last draft key
    window._lastDraftKey   = all[0].key;
    window._lastDraftEntry = last;
  } else {
    $("last-draft-card").classList.add("hidden");
    $("no-draft-msg").style.display = "";
  }
}

// ── Actions ────────────────────────────────────────────────────
$("btn-save-now").addEventListener("click", async () => {
  const resp = await sendToTab({ type: "SAVE_NOW" });
  if (resp?.success) { toast("✓ Saved!"); loadAll(); }
  else toast("Could not save — reload the page", "err");
});

$("btn-restore-last").addEventListener("click", async () => {
  if (!window._lastDraftKey) {
    return toast("No drafts found yet", "err");
  }
  const resp = await sendToTab({
    type: "RESTORE_SPECIFIC",
    key: window._lastDraftKey,
    value: window._lastDraftEntry.value,
  });
  if (resp?.success) { toast("✓ Restored!"); window.close(); }
  else {
    // Fallback: trigger generic restore
    await sendToTab({ type: "RESTORE_NOW" });
    toast("Check the page for a restore banner");
    window.close();
  }
});

$("btn-dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  window.close();
});

// ── Init ───────────────────────────────────────────────────────
loadAll();
