(function () {
"use strict";

// ─────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────
var SAVE_DELAY_MS    = 3000;
var SAVE_INTERVAL_MS = 5000;
var TOAST_MS         = 2000;
var LS_PFX           = "ws::";
var SETTINGS_KEY     = "ws-settings-cache"; // local cache of settings

// ─────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────
var timers           = {};
var toastTimer       = null;
var mutationObserver = null;
var restoring        = false;
var settings = { autosave: true, formdetect: true, notifs: true, crash: true };

// Load settings from localStorage cache (written by popup)
try {
  var cached = localStorage.getItem(SETTINGS_KEY);
  if (cached) settings = JSON.parse(cached);
} catch(_) {}

// ─────────────────────────────────────────────────────────────────
// SAFE CHROME WRAPPER
// ─────────────────────────────────────────────────────────────────
function safe(fn) {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) return;
    fn();
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
// LOCALSTORAGE
// ─────────────────────────────────────────────────────────────────
function lsWrite(key, entry) {
  try { localStorage.setItem(LS_PFX + key, JSON.stringify(entry)); } catch (_) {}
}

function lsReadAll() {
  var out = {};
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LS_PFX) === 0) {
        try { out[k.slice(LS_PFX.length)] = JSON.parse(localStorage.getItem(k)); } catch (_) {}
      }
    }
  } catch (_) {}
  return out;
}

function lsDelete(key) {
  try { localStorage.removeItem(LS_PFX + key); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
// SAVE AN ENTRY
// ─────────────────────────────────────────────────────────────────
function saveEntry(key, entry) {
  lsWrite(key, entry);
  safe(function () {
    var payload = {};
    payload[key] = entry;
    chrome.storage.local.set(payload, function () {
      try { void chrome.runtime.lastError; } catch (_) {}
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// FIELD KEY
// ─────────────────────────────────────────────────────────────────
function fieldKey(el) {
  var url  = location.href.split("?")[0];
  var tag  = el.tagName.toLowerCase();
  var id   = el.id   ? "#" + el.id   : "";
  var name = el.name ? '[name="' + el.name + '"]' : "";
  var ph   = el.placeholder
    ? '[ph="' + el.placeholder.slice(0, 30) + '"]' : "";
  var aria = el.getAttribute("aria-label")
    ? '[aria="' + el.getAttribute("aria-label").slice(0, 30) + '"]' : "";
  var idx  = "";
  if (!id && !name) {
    var all = Array.from(document.querySelectorAll("input,textarea,[contenteditable]"));
    var pos = all.indexOf(el);
    if (pos >= 0) idx = "[i" + pos + "]";
  }
  return "ws::" + url + "::" + tag + id + name + ph + aria + idx;
}

// ─────────────────────────────────────────────────────────────────
// READ / WRITE ELEMENT VALUE
// ─────────────────────────────────────────────────────────────────
function readValue(el) {
  try {
    return el.isContentEditable ? (el.innerText || "") : (el.value || "");
  } catch (_) { return ""; }
}

function writeValue(el, text) {
  try {
    if (el.isContentEditable) {
      el.innerText = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      var proto  = el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
// SAVE A SINGLE FIELD
// ─────────────────────────────────────────────────────────────────
function saveField(el) {
  if (restoring) return;
  if (!settings.autosave) return;
  var value = readValue(el).trim();
  if (!value) return;

  var key   = fieldKey(el);
  var entry = { value: value, savedAt: Date.now(), url: location.href, hostname: location.hostname };

  saveEntry(key, entry);
  showToast("✓ Draft saved");

  safe(function () {
    chrome.runtime.sendMessage({ type: "FIELD_SAVED" }, function () {
      try { void chrome.runtime.lastError; } catch (_) {}
    });
  });
}

function debounce(el) {
  var k = fieldKey(el);
  if (timers[k]) clearTimeout(timers[k]);
  timers[k] = setTimeout(function () { saveField(el); delete timers[k]; }, SAVE_DELAY_MS);
}

function saveAll() {
  fields().forEach(function (el) {
    if (readValue(el).trim()) saveField(el);
  });
}

// ─────────────────────────────────────────────────────────────────
// RESTORE
// ─────────────────────────────────────────────────────────────────
function checkRestore() {
  if (!settings.notifs) return;
  var pageUrl = location.href.split("?")[0];
  var all     = lsReadAll();
  var matches = Object.keys(all).filter(function (k) {
    return k.indexOf("ws::" + pageUrl + "::") === 0;
  });
  if (matches.length) showRestoreBanner(matches, all);
}

function restoreField(key, value) {
  restoring = true;
  var suffix = key.split("::").slice(2).join("::");
  fields().forEach(function (el) {
    if (fieldKey(el).split("::").slice(2).join("::") === suffix) {
      writeValue(el, value);
      try { el.focus(); } catch (_) {}
    }
  });
  restoring = false;
}

function restoreSpecific(key, value) {
  restoring = true;
  var suffix = key.split("::").slice(2).join("::");
  fields().forEach(function (el) {
    if (fieldKey(el).split("::").slice(2).join("::") === suffix) {
      writeValue(el, value);
      try { el.focus(); } catch (_) {}
    }
  });
  restoring = false;
  showToast("✓ Draft restored!");
}

function restoreAll(keys, all) {
  keys.forEach(function (k) {
    if (all[k] && all[k].value) restoreField(k, all[k].value);
  });
  showToast("✓ Work restored!");
  // Notify background to increment restoration count
  safe(function () {
    chrome.runtime.sendMessage({ type: "RESTORED" }, function () {
      try { void chrome.runtime.lastError; } catch (_) {}
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// UI — toast + restore banner
// ─────────────────────────────────────────────────────────────────
function showToast(msg) {
  var t = document.getElementById("ws-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "ws-toast";
    t.style.cssText =
      "position:fixed;bottom:20px;right:20px;background:#10b981;color:#fff;" +
      "padding:8px 16px;border-radius:20px;font-size:13px;font-family:-apple-system,sans-serif;" +
      "font-weight:600;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.2);" +
      "opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;" +
      "pointer-events:none;letter-spacing:0.1px";
    try { document.body.appendChild(t); } catch (_) { return; }
  }
  t.textContent = msg;
  requestAnimationFrame(function () {
    t.style.opacity = "1"; t.style.transform = "translateY(0)";
  });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    t.style.opacity = "0"; t.style.transform = "translateY(8px)";
  }, TOAST_MS);
}

function showRestoreBanner(keys, all) {
  if (document.getElementById("ws-banner")) return;
  var b = document.createElement("div");
  b.id = "ws-banner";
  b.style.cssText =
    "position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
    "background:#fff;border:1.5px solid #10b981;border-radius:14px;" +
    "padding:14px 18px;display:flex;align-items:center;gap:12px;" +
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    "font-size:13px;color:#0f172a;" +
    "z-index:2147483647;box-shadow:0 8px 32px rgba(0,0,0,.15);" +
    "max-width:420px;width:calc(100vw - 40px)";

  var icon = document.createElement("div");
  icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="#10b981"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>';
  icon.style.flexShrink = "0";

  var msg = document.createElement("div");
  msg.style.flex = "1";
  var title = document.createElement("div");
  title.style.cssText = "font-weight:700;font-size:13px;margin-bottom:2px";
  title.textContent = "Preserve Vault — Unsaved work found";
  var sub = document.createElement("div");
  sub.style.cssText = "font-size:11px;color:#64748b";
  sub.textContent = keys.length + " field" + (keys.length > 1 ? "s" : "") + " from your last visit";
  msg.appendChild(title);
  msg.appendChild(sub);

  function btn(label, bg, color) {
    var el = document.createElement("button");
    el.textContent = label;
    el.style.cssText =
      "background:" + bg + ";color:" + color + ";border:none;" +
      "padding:7px 15px;border-radius:8px;cursor:pointer;" +
      "font-size:12px;font-weight:700;white-space:nowrap;" +
      "font-family:inherit;transition:filter 0.15s";
    return el;
  }

  var restoreBtn = btn("Restore", "#10b981", "#fff");
  var dismissBtn = btn("Dismiss", "#f1f5f9", "#64748b");
  restoreBtn.onclick = function () { restoreAll(keys, all); b.remove(); };
  dismissBtn.onclick = function () { b.remove(); };

  b.appendChild(icon);
  b.appendChild(msg);
  b.appendChild(restoreBtn);
  b.appendChild(dismissBtn);
  try { document.body.appendChild(b); } catch (_) { return; }
  setTimeout(function () { try { b.remove(); } catch (_) {} }, 30000);
}

// ─────────────────────────────────────────────────────────────────
// FIELD DETECTION
// ─────────────────────────────────────────────────────────────────
var EXCLUDED = ["password","email","tel","number","hidden","file",
                "submit","button","checkbox","radio","color","range","date",
                "datetime-local","month","time","week"];

function fields() {
  if (!settings.formdetect) return [];
  var inputs = Array.from(document.querySelectorAll(
    "input[type='text'],input[type='search'],input:not([type]),textarea"
  )).filter(function (el) {
    return EXCLUDED.indexOf((el.type || "").toLowerCase()) === -1;
  });
  var editables = Array.from(
    document.querySelectorAll("[contenteditable='true'],[contenteditable='']")
  );
  return inputs.concat(editables);
}

function attach(el) {
  if (el._wsSaved) return;
  el._wsSaved = true;
  el.addEventListener("input",   function () { if (settings.autosave) debounce(el); });
  el.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === "Enter" || e.key === "s")) {
      saveField(el);
    }
  });
}

function scan() { fields().forEach(attach); }

// ─────────────────────────────────────────────────────────────────
// MUTATION OBSERVER
// ─────────────────────────────────────────────────────────────────
function startObserver() {
  if (mutationObserver) return;
  mutationObserver = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length) { scan(); return; }
    }
  });
  try { mutationObserver.observe(document.body, { childList: true, subtree: true }); } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
// BEFORE UNLOAD
// ─────────────────────────────────────────────────────────────────
window.addEventListener("beforeunload", function () {
  if (!settings.crash) return;
  Object.keys(timers).forEach(function (k) { clearTimeout(timers[k]); });
  timers = {};
  fields().forEach(function (el) {
    var v = readValue(el).trim();
    if (!v) return;
    lsWrite(fieldKey(el), { value: v, savedAt: Date.now(), url: location.href, hostname: location.hostname });
  });
});

// ─────────────────────────────────────────────────────────────────
// PERIODIC SAVE
// ─────────────────────────────────────────────────────────────────
setInterval(function () {
  if (!settings.autosave) return;
  fields().forEach(function (el) {
    var v = readValue(el).trim();
    if (!v) return;
    lsWrite(fieldKey(el), { value: v, savedAt: Date.now(), url: location.href, hostname: location.hostname });
  });
}, SAVE_INTERVAL_MS);

// ─────────────────────────────────────────────────────────────────
// MESSAGE LISTENER
// ─────────────────────────────────────────────────────────────────
safe(function () {
  chrome.runtime.onMessage.addListener(function (msg, _sender, respond) {
    try {
      if (msg.type === "SAVE_NOW") {
        saveAll();
        respond({ success: true });
        return true;
      }

      if (msg.type === "RESTORE_NOW") {
        checkRestore();
        respond({ success: true });
        return true;
      }

      if (msg.type === "RESTORE_SPECIFIC") {
        // Restore a single named draft into matching field
        restoreSpecific(msg.key, msg.value);
        respond({ success: true });
        return true;
      }

      if (msg.type === "GET_STATUS") {
        var f = fields();
        respond({ fieldCount: f.length, url: location.href, hostname: location.hostname });
        return true;
      }

      if (msg.type === "GET_FIELDS_DETAIL") {
        var detail = fields().map(function (el) {
          var type = el.isContentEditable ? "editable"
            : el.tagName.toLowerCase() === "textarea" ? "textarea" : "input";
          var label =
            el.getAttribute("aria-label") || el.placeholder || el.name ||
            (el.id ? "#" + el.id : null) || el.getAttribute("title") ||
            type + " field";
          return { type: type, label: String(label).slice(0, 60), value: readValue(el).trim().slice(0, 120) };
        });
        respond({ fields: detail });
        return true;
      }

      if (msg.type === "GET_LS_DRAFTS") {
        respond({ drafts: lsReadAll() });
        return true;
      }

      if (msg.type === "CLEAR_LS_KEYS") {
        if (Array.isArray(msg.keys)) {
          msg.keys.forEach(function (k) { lsDelete(k); });
        }
        respond({ ok: true });
        return true;
      }

      if (msg.type === "UPDATE_LS_DRAFT") {
        // Update a draft value in localStorage (from editor)
        lsWrite(msg.key, msg.entry);
        respond({ ok: true });
        return true;
      }

      if (msg.type === "UPDATE_SETTINGS") {
        // Sync settings from popup into local cache
        settings = Object.assign(settings, msg.settings || {});
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch(_) {}
        respond({ ok: true });
        return true;
      }

    } catch (_) {
      try { respond({ success: false }); } catch (_) {}
    }
    return true;
  });
});

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────
function init() {
  scan();
  startObserver();
  setTimeout(checkRestore, 800);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();
