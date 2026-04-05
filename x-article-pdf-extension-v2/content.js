/**
 * content.js  v6
 *
 * Fixes in this version:
 *   [1] Bold heading detection — now checks entire ancestor chain for
 *       font-weight, not just direct child spans. Catches X's pattern of
 *       <span data-offset-key style="font-weight:bold"><span data-text>
 *   [2] Unicode sanitization — replaces arrows (→ ← ↑ ↓ ➜ etc.) and
 *       other chars Helvetica can't render. Prevents garbled & symbols.
 *   [3] Link text extraction — when a [data-text] leaf is inside an <a>,
 *       we grab its plain text only (no href pollution).
 *   [4] Scroll boundary — stops exactly at article bottom, not page bottom.
 */

'use strict';

// ─── Stable Selectors ─────────────────────────────────────────────────────────

const SEL_ARTICLE_VIEW   = '[data-testid="twitterArticleReadView"]';
const SEL_RICH_TEXT_VIEW = '[data-testid="twitterArticleRichTextView"]';
const SEL_DRAFT_ROOT     = '[data-testid="longformRichTextComponent"]';
const SEL_TITLE          = '[data-testid="twitter-article-title"]';
const SEL_DATA_BLOCK     = '[data-block="true"]';
const SEL_TEXT_LEAF      = '[data-text="true"]';
const SEL_OL_ITEM        = '.public-DraftStyleDefault-orderedListItem';
const SEL_UL_ITEM        = '.public-DraftStyleDefault-unorderedListItem';

// ─── Unicode Sanitizer ────────────────────────────────────────────────────────

/**
 * Replaces characters that jsPDF's built-in Helvetica font cannot render.
 * Un-renderable glyphs corrupt the entire text run surrounding them,
 * producing garbled output with & symbols and spaced-out characters.
 */
function sanitize(str) {
  return str
    // Arrows → ASCII equivalents
    .replace(/→|➜|➡|▶/g, '->')
    .replace(/←|⬅|◀/g, '<-')
    .replace(/↑|⬆/g, '^')
    .replace(/↓|⬇/g, 'v')
    .replace(/↔/g, '<->')
    // Smart quotes → straight quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Dashes
    .replace(/[\u2013\u2014]/g, '-')
    // Ellipsis
    .replace(/\u2026/g, '...')
    // Bullet / dot symbols
    .replace(/[\u2022\u2023\u25E6\u2043]/g, '*')
    // Checkmarks
    .replace(/[\u2713\u2714\u2705]/g, '[x]')
    .replace(/[\u2717\u2718]/g, '[ ]')
    // Zero-width chars
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Any remaining non-Latin-1 characters (safe fallback)
    .replace(/[^\x00-\xFF]/g, ' ')
    .trim();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function waitFor(conditionFn, timeout = 10000, interval = 200) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick  = () => {
      if (conditionFn()) { resolve(true); return; }
      if (Date.now() - start > timeout) { resolve(false); return; }
      setTimeout(tick, interval);
    };
    tick();
  });
}

function sendProgress(jobId, phase, value) {
  chrome.runtime.sendMessage({ action: 'PROGRESS', phase, value, jobId });
}

// ─── Scroll Container ─────────────────────────────────────────────────────────

function findScrollContext() {
  const articleEl = document.querySelector(SEL_ARTICLE_VIEW);
  if (!articleEl) {
    return { articleEl: null, scrollEl: document.scrollingElement || document.documentElement };
  }
  let node = articleEl.parentElement;
  while (node && node !== document.documentElement) {
    const oy = window.getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
        node.scrollHeight > node.clientHeight + 20) {
      return { articleEl, scrollEl: node };
    }
    node = node.parentElement;
  }
  return { articleEl, scrollEl: document.scrollingElement || document.documentElement };
}

// ─── Scroll — stops at article bottom ────────────────────────────────────────

function scrollArticleIntoView(scrollEl, articleEl, onProgress) {
  return new Promise((resolve) => {
    let lastTop = -1, stalledTicks = 0, newContent = false;

    let observer;
    try {
      observer = new MutationObserver(() => { newContent = true; });
      observer.observe(articleEl, { childList: true, subtree: true });
    } catch (_) {}

    scrollEl.scrollTop = 0;

    const isPageScroller = scrollEl === document.documentElement ||
                           scrollEl === document.scrollingElement;

    function isArticleFullyVisible() {
      const artBottom    = articleEl.getBoundingClientRect().bottom;
      const viewportBottom = isPageScroller
        ? window.innerHeight
        : scrollEl.getBoundingClientRect().bottom;
      return artBottom <= viewportBottom + 20;
    }

    function getProgress() {
      const artRect    = articleEl.getBoundingClientRect();
      const viewBottom = isPageScroller ? window.innerHeight : scrollEl.getBoundingClientRect().bottom;
      const visible    = viewBottom - artRect.top;
      return Math.min(99, Math.max(0, Math.round((visible / artRect.height) * 100)));
    }

    function step() {
      onProgress(getProgress());

      if (isArticleFullyVisible()) {
        if (observer) observer.disconnect();
        onProgress(100); resolve(); return;
      }

      const top = scrollEl.scrollTop;
      if (Math.abs(top - lastTop) < 2) {
        if (newContent) { stalledTicks = 0; newContent = false; }
        else { stalledTicks++; }
        if (stalledTicks > 20) {
          if (observer) observer.disconnect();
          onProgress(100); resolve(); return;
        }
      } else { stalledTicks = 0; newContent = false; }
      lastTop = top;

      scrollEl.scrollBy({ top: randInt(180, 440), behavior: 'smooth' });
      setTimeout(step, randInt(150, 360));
    }

    setTimeout(step, 300);
  });
}

// ─── Text Extraction ──────────────────────────────────────────────────────────

/**
 * Determines whether ALL text leaves in a block are rendered bold.
 * Checks the entire ancestor chain up to blockEl for font-weight.
 * This handles X's structure: <span style="font-weight:bold"><span data-text>
 */
function isEntirelyBold(blockEl) {
  const leaves = blockEl.querySelectorAll(SEL_TEXT_LEAF);
  if (leaves.length === 0) return false;

  for (const leaf of leaves) {
    // Walk up from leaf to blockEl checking for bold
    let node = leaf;
    let foundBold = false;
    while (node && node !== blockEl) {
      const fw = node.style && node.style.fontWeight;
      if (fw === 'bold' || fw === '700' || fw === '600') {
        foundBold = true; break;
      }
      // Also check computed style
      if (window.getComputedStyle(node).fontWeight >= 600) {
        foundBold = true; break;
      }
      node = node.parentElement;
    }
    if (!foundBold) return false; // this leaf isn't bold → not entirely bold
  }
  return true;
}

async function extractArticleContent() {
  // ── Title ──────────────────────────────────────────────────────────────────
  const titleEl = document.querySelector(SEL_TITLE);
  const title   = titleEl
    ? sanitize((titleEl.innerText || '').trim())
    : sanitize(document.title.replace(/ \/ X$/i, '').replace(/ \/ Twitter$/i, '').trim()) || 'X Article';

  // ── Wait for DraftJS root ─────────────────────────────────────────────────
  await waitFor(() => {
    const root = document.querySelector(SEL_DRAFT_ROOT);
    return root && root.querySelectorAll(SEL_TEXT_LEAF).length > 0;
  }, 10000, 250);

  const draftRoot = document.querySelector(SEL_DRAFT_ROOT);

  if (!draftRoot) {
    // Fallback: grab any data-text in article view
    const articleView = document.querySelector(SEL_ARTICLE_VIEW) ||
                        document.querySelector(SEL_RICH_TEXT_VIEW);
    if (articleView) {
      const blocks = [];
      for (const leaf of articleView.querySelectorAll(SEL_TEXT_LEAF)) {
        const text = sanitize(leaf.textContent || '');
        if (text.length > 0) blocks.push({ type: 'p', text });
      }
      return { title, blocks };
    }
    return { title, blocks: [] };
  }

  // ── Walk DraftJS blocks ───────────────────────────────────────────────────
  const blocks   = [];
  const blockEls = draftRoot.querySelectorAll(SEL_DATA_BLOCK);

  for (const blockEl of blockEls) {
    const leaves = blockEl.querySelectorAll(SEL_TEXT_LEAF);
    if (leaves.length === 0) continue;

    // Collect raw text from all leaves
    let raw = '';
    for (const leaf of leaves) raw += leaf.textContent || '';
    const text = sanitize(raw);
    if (!text) continue;

    // ── Block type ──────────────────────────────────────────────────────────
    let type = 'p';
    const cls = blockEl.className || '';

    if (blockEl.closest(SEL_OL_ITEM) || cls.includes('orderedListItem')  ||
        blockEl.closest(SEL_UL_ITEM) || cls.includes('unorderedListItem') ||
        blockEl.closest('li')) {
      type = 'li';
    } else if (cls.includes('header-one')   || blockEl.closest('[class*="header-one"]'))   { type = 'h1'; }
    else if (cls.includes('header-two')   || blockEl.closest('[class*="header-two"]'))   { type = 'h2'; }
    else if (cls.includes('header-three') || blockEl.closest('[class*="header-three"]')) { type = 'h3'; }
    else if (cls.includes('blockquote')   || blockEl.closest('[class*="blockquote"]'))   { type = 'blockquote'; }
    else if (cls.includes('code-block')   || blockEl.closest('[class*="code-block"]'))   { type = 'pre'; }
    else if (isEntirelyBold(blockEl)) {
      // Fully-bold unstyled paragraph → treat as section heading
      type = 'h3';
    }

    blocks.push({ type, text });
  }

  // De-duplicate exact consecutive blocks
  const deduped = blocks.filter((b, i) => i === 0 || b.text !== blocks[i - 1].text);
  return { title, blocks: deduped };
}

// ─── Message Listener ─────────────────────────────────────────────────────────

if (!globalThis.__xArticlePdfListenerRegistered) {
  globalThis.__xArticlePdfListenerRegistered = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    if (message.action === 'PING') {
      const hasArticle = !!(document.querySelector(SEL_ARTICLE_VIEW) ||
                            document.querySelector(SEL_DRAFT_ROOT));
      sendResponse({ ready: true, url: location.href, hasArticle });
      return true;
    }

    if (message.action === 'SCROLL_AND_EXTRACT') {
      (async () => {
        const jobId = message.jobId || null;
        try {
          sendProgress(jobId, 'scroll', 0);

          await waitFor(() => !!document.querySelector(SEL_ARTICLE_VIEW), 8000, 300);

          const { articleEl, scrollEl } = findScrollContext();

          if (articleEl) {
            await scrollArticleIntoView(scrollEl, articleEl, (pct) => {
              sendProgress(jobId, 'scroll', pct);
            });
          } else {
            sendProgress(jobId, 'scroll', 100);
          }

          await new Promise(r => setTimeout(r, 800));
          scrollEl.scrollTop = 0;

          sendProgress(jobId, 'extract', 30);
          const { title, blocks } = await extractArticleContent();
          sendProgress(jobId, 'extract', 100);

          if (blocks.length === 0) {
            sendResponse({ ok: false, error: 'No text extracted. Wait for the page to fully load, then try again.' });
          } else {
            sendResponse({ ok: true, title, blocks });
          }
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
      })();
      return true;
    }
  });
}
