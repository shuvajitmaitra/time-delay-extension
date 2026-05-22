'use strict';

/**
 * Service worker — intercepts navigations and redirects matched URLs to the
 * timer page. After the countdown, the timer page sends ALLOW_REDIRECT so the
 * final navigation to the original site is not blocked again.
 */

const ALLOW_WINDOW_MS = 8000; // How long the per-tab allow window stays open

// ─── Navigation interception ─────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async ({ url, tabId, frameId }) => {
  // Only intercept top-level navigations
  if (frameId !== 0) return;

  // Skip browser-internal and extension pages
  if (isInternalUrl(url)) return;

  // Check if this tab was cleared by a completed timer
  try {
    const key = `allow_${tabId}`;
    const stored = await chrome.storage.session.get(key);
    const entry = stored[key];
    if (entry) {
      await chrome.storage.session.remove(key);
      if (Date.now() < entry.until && sameDomain(url, entry.targetUrl)) {
        return; // Let the post-timer redirect through
      }
    }
  } catch {
    // chrome.storage.session unavailable (Chrome < 102) — no bypass protection
  }

  const {
    blockedSites = [],
    globalEnabled = true,
    focusMode = false,
    focusModeDelay = 15,
  } = await chrome.storage.local.get([
    'blockedSites',
    'globalEnabled',
    'focusMode',
    'focusModeDelay',
  ]);

  if (!globalEnabled) return;

  let rule = matchRule(url, blockedSites);

  // Focus mode: apply a default delay to any unmatched URL
  if (!rule && focusMode) {
    rule = { url: '*', delay: focusModeDelay };
  }

  if (!rule) return;

  const timerUrl = buildTimerUrl(url, rule);
  try {
    await chrome.tabs.update(tabId, { url: timerUrl });
  } catch {
    // Tab was closed or became inaccessible
  }
});

// ─── Allow-redirect message handler ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type !== 'ALLOW_REDIRECT') return false;

  const tabId = sender.tab?.id;
  if (!tabId) {
    respond({ ok: false });
    return true;
  }

  chrome.storage.session
    .set({
      [`allow_${tabId}`]: {
        targetUrl: msg.targetUrl,
        until: Date.now() + ALLOW_WINDOW_MS,
      },
    })
    .then(() => respond({ ok: true }))
    .catch(() => respond({ ok: true })); // Proceed even if storage write fails

  return true; // Keep message channel open for async response
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isInternalUrl(url) {
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('data:') ||
    url.startsWith('devtools://') ||
    url.startsWith('edge://')
  );
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function sameDomain(a, b) {
  const da = getDomain(a);
  const db = getDomain(b);
  return da !== null && da === db;
}

function normalizeSiteInput(raw) {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase();
}

function matchRule(url, rules) {
  const domain = getDomain(url);
  if (!domain) return null;

  for (const rule of rules) {
    if (rule.enabled === false) continue;

    const pattern = normalizeSiteInput(rule.url);
    if (!pattern) continue;

    // Wildcard: match everything
    if (pattern === '*') return rule;

    // Subdomain wildcard: *.example.com
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      if (domain === base || domain.endsWith('.' + base)) return rule;
      continue;
    }

    // Exact domain or subdomain match
    if (domain === pattern || domain.endsWith('.' + pattern)) return rule;
  }

  return null;
}

function buildTimerUrl(targetUrl, rule) {
  const base = chrome.runtime.getURL('timer.html');
  const params = new URLSearchParams({
    url: targetUrl,
    delay: String(rule.delay),
    site: rule.url,
  });
  return `${base}?${params}`;
}
