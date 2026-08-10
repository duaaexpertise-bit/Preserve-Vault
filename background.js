/**
 * Preserve Vault — Background Service Worker (Premium)
 */

const STALE_DATA_DAYS        = 7;
const CLEANUP_ALARM          = "ws-cleanup";
const CLEANUP_INTERVAL_MINS  = 60 * 24;

const DEFAULT_SETTINGS = {
  autosave:    true,
  formdetect:  true,
  notifs:      true,
  crash:       true,
};

// ── Install ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(CLEANUP_ALARM, {
    delayInMinutes:  1,
    periodInMinutes: CLEANUP_INTERVAL_MINS,
  });
  // Seed meta if missing
  chrome.storage.local.get("ws-meta", (data) => {
    if (!data["ws-meta"]) {
      chrome.storage.local.set({
        "ws-meta": { restored: 0, lastActivity: null },
        "ws-settings": DEFAULT_SETTINGS,
      });
    }
  });
});

// ── Alarm: stale cleanup ───────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CLEANUP_ALARM) cleanStaleData();
});

function cleanStaleData() {
  const cutoff = Date.now() - STALE_DATA_DAYS * 86400000;
  chrome.storage.local.get(null, (all) => {
    const remove = Object.entries(all)
      .filter(([k, v]) => k.startsWith("ws::") && v.savedAt && v.savedAt < cutoff)
      .map(([k]) => k);
    if (remove.length) chrome.storage.local.remove(remove);
  });
}

// ── Navigation: save before leaving ───────────────────────────────
if (chrome.webNavigation) {
  chrome.webNavigation.onBeforeNavigate?.addListener((details) => {
    if (details.frameId !== 0) return;
    chrome.tabs.sendMessage(details.tabId, { type: "SAVE_NOW" }).catch(() => {});
  });
}

// ── Messages ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {

  // ── Stats ──────────────────────────────────────────────────────
  if (msg.type === "GET_STATS") {
    chrome.storage.local.get(null, (all) => {
      const meta = all["ws-meta"] || {};
      const draftEntries = Object.entries(all).filter(([k]) => k.startsWith("ws::"));
      const drafts = draftEntries.length;
      const storageBytes = draftEntries.reduce((acc, [, v]) => {
        return acc + (v?.value?.length || 0) * 2; // rough UTF-16 estimate
      }, 0);
      respond({
        drafts,
        restored:     meta.restored    || 0,
        lastActivity: meta.lastActivity || null,
        storageBytes,
      });
    });
    return true;
  }

  // ── Count ──────────────────────────────────────────────────────
  if (msg.type === "GET_SAVED_COUNT") {
    chrome.storage.local.get(null, (all) => {
      respond({ count: Object.keys(all).filter(k => k.startsWith("ws::")).length });
    });
    return true;
  }

  // ── All drafts ─────────────────────────────────────────────────
  if (msg.type === "GET_ALL_DRAFTS") {
    chrome.storage.local.get(null, (all) => {
      const drafts = Object.entries(all)
        .filter(([k]) => k.startsWith("ws::"))
        .map(([key, entry]) => ({ key, entry }));
      respond({ drafts });
    });
    return true;
  }

  // ── Settings ───────────────────────────────────────────────────
  if (msg.type === "GET_SETTINGS") {
    chrome.storage.local.get("ws-settings", (data) => {
      respond({ settings: data["ws-settings"] || DEFAULT_SETTINGS });
    });
    return true;
  }

  if (msg.type === "SAVE_SETTINGS") {
    chrome.storage.local.set({ "ws-settings": msg.settings }, () => respond({ ok: true }));
    return true;
  }

  // ── Update a single draft ──────────────────────────────────────
  if (msg.type === "UPDATE_DRAFT") {
    const payload = { [msg.key]: msg.entry };
    chrome.storage.local.set(payload, () => {
      updateMeta({ lastActivity: Date.now() });
      respond({ ok: true });
    });
    return true;
  }

  // ── Clear one page ─────────────────────────────────────────────
  if (msg.type === "CLEAR_PAGE") {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all).filter(k => k.startsWith(`ws::${msg.url}::`));
      chrome.storage.local.remove(keys, () => respond({ removed: keys.length }));
    });
    return true;
  }

  // ── Clear specific keys ────────────────────────────────────────
  if (msg.type === "CLEAR_KEYS") {
    chrome.storage.local.remove(msg.keys || [], () => {
      respond({ removed: (msg.keys || []).length });
    });
    return true;
  }

  // ── Clear all ─────────────────────────────────────────────────
  if (msg.type === "CLEAR_ALL") {
    chrome.storage.local.get(null, (all) => {
      const keys = Object.keys(all).filter(k => k.startsWith("ws::"));
      chrome.storage.local.remove(keys, () => respond({ removed: keys.length }));
    });
    return true;
  }

  // ── Field saved ping ──────────────────────────────────────────
  if (msg.type === "FIELD_SAVED") {
    updateMeta({ lastActivity: Date.now() });
    chrome.action.setBadgeText({ text: "✓" }).catch(() => {});
    chrome.action.setBadgeBackgroundColor({ color: "#10b981" }).catch(() => {});
    setTimeout(() => chrome.action.setBadgeText({ text: "" }).catch(() => {}), 2000);
  }

  // ── Restoration count ─────────────────────────────────────────
  if (msg.type === "RESTORED") {
    chrome.storage.local.get("ws-meta", (data) => {
      const meta = data["ws-meta"] || {};
      meta.restored = (meta.restored || 0) + 1;
      meta.lastActivity = Date.now();
      chrome.storage.local.set({ "ws-meta": meta });
    });
  }
});

function updateMeta(patch) {
  chrome.storage.local.get("ws-meta", (data) => {
    const meta = data["ws-meta"] || {};
    Object.assign(meta, patch);
    chrome.storage.local.set({ "ws-meta": meta });
  });
}
