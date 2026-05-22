'use strict';

// ─── Parse URL parameters ─────────────────────────────────────────────────────
const params     = new URLSearchParams(location.search);
const targetUrl  = params.get('url');
const totalDelay = Math.max(1, parseInt(params.get('delay'), 10) || 30);
const siteParam  = params.get('site') || targetUrl || '';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const countEl     = document.getElementById('countdown');
const siteEl      = document.getElementById('siteName');
const ring        = document.getElementById('progressRing');
const progressBar = document.getElementById('progressBar');
const overlay     = document.getElementById('overlay');

// ─── Ring geometry ────────────────────────────────────────────────────────────
const RADIUS       = 96;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~603.2

// Set initial state without any CSS transition (avoids flash on load)
ring.style.strokeDasharray  = String(CIRCUMFERENCE);
ring.style.strokeDashoffset = '0'; // Full ring = no time elapsed

progressBar.style.width      = '100%';
progressBar.style.transition = 'none';

// Enable smooth transitions after the first paint
requestAnimationFrame(() => {
  ring.style.transition        = 'stroke-dashoffset 0.9s linear';
  progressBar.style.transition = 'width 0.9s linear';
});

// ─── Display site name ────────────────────────────────────────────────────────
if (siteEl) {
  let display = siteParam;
  try {
    const u = new URL(siteParam.startsWith('http') ? siteParam : `https://${siteParam}`);
    display = u.hostname.replace(/^www\./i, '');
  } catch { /* keep raw value */ }
  siteEl.textContent = display;
}

document.title = `Pausing… (${totalDelay}s)`;

// ─── State ────────────────────────────────────────────────────────────────────
let remaining  = totalDelay;
let ticker     = null;
let redirecting = false;

// ─── Render one frame ─────────────────────────────────────────────────────────
function render() {
  const elapsed  = totalDelay - remaining;
  const progress = elapsed / totalDelay; // 0 → 1 as time passes

  countEl.textContent  = String(remaining);
  document.title       = `Pausing… (${remaining}s)`;

  // Ring drains from full (offset=0) to empty (offset=CIRCUMFERENCE)
  ring.style.strokeDashoffset = String(CIRCUMFERENCE * progress);

  // Linear bar shrinks from 100% to 0%
  progressBar.style.width = `${(1 - progress) * 100}%`;

  // Pulse the countdown number on each tick
  countEl.classList.remove('pulse');
  void countEl.offsetWidth; // Force reflow to restart the animation
  countEl.classList.add('pulse');
}

// ─── Redirect after countdown ─────────────────────────────────────────────────
async function doRedirect() {
  if (redirecting) return;
  redirecting = true;
  clearInterval(ticker);

  // Final visual state
  countEl.textContent = '✓';
  ring.style.strokeDashoffset = String(CIRCUMFERENCE); // Empty ring
  progressBar.style.width = '0%';
  overlay.classList.add('fade-out');

  if (!targetUrl) return;

  // Tell background.js to let this tab through the blocker for the next navigation
  await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'ALLOW_REDIRECT', targetUrl }, resolve);
    } catch {
      resolve(); // Messaging failed — proceed anyway
    }
  });

  // Brief pause to let the fade-out animate before navigating
  await new Promise((r) => setTimeout(r, 420));

  window.location.href = targetUrl;
}

// ─── Tick ─────────────────────────────────────────────────────────────────────
function tick() {
  remaining = Math.max(0, remaining - 1);
  render();
  if (remaining === 0) doRedirect();
}

// ─── Back-navigation prevention ───────────────────────────────────────────────
// Push a state so the back button doesn't escape the timer silently.
history.pushState(null, '', location.href);
window.addEventListener('popstate', () => {
  if (!redirecting) history.pushState(null, '', location.href);
});

// ─── Warn on close / navigate away ───────────────────────────────────────────
window.addEventListener('beforeunload', (e) => {
  if (redirecting) return;
  e.preventDefault();
  e.returnValue = ''; // Shows browser's built-in "leave site?" dialog
});

// ─── Bootstrap ────────────────────────────────────────────────────────────────
render();
ticker = setInterval(tick, 1000);
