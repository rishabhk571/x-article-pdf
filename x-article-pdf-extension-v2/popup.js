/**
 * popup.js  v6
 *
 * Changes vs v5:
 *   [1] Article title rendered as large bold H1 at very top of PDF
 *   [2] Horizontal rule drawn under title to separate from body
 *   [3] Better spacing between all block types (headings breathe more)
 *   [4] h3 sections get a subtle grey underline to distinguish them
 *   [5] Page numbers added at bottom right
 */

'use strict';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const urlBadge    = document.getElementById('urlBadge');
const urlText     = document.getElementById('urlText');
const warnBox     = document.getElementById('warnBox');
const progressArea= document.getElementById('progressArea');
const phaseLabel  = document.getElementById('phaseLabel');
const phasePct    = document.getElementById('phasePct');
const barFill     = document.getElementById('barFill');
const convertBtn  = document.getElementById('convertBtn');
const btnText     = document.getElementById('btnText');
const resultBanner= document.getElementById('resultBanner');
const resultIcon  = document.getElementById('resultIcon');
const resultText  = document.getElementById('resultText');

const phaseSteps = {
  scroll:  document.getElementById('phase-scroll'),
  extract: document.getElementById('phase-extract'),
  pdf:     document.getElementById('phase-pdf'),
};

let activeTabId   = null;
let isArticlePage = false;
let activeJobId   = null;
let currentPhaseIndex = -1;
let jobCompleted  = false;

const bgPort = chrome.runtime.connect({ name: 'popup' });
bgPort.onMessage.addListener((msg) => {
  if (msg.action === 'PROGRESS') handleProgress(msg.phase, msg.value, msg.jobId);
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  activeTabId = tab.id;
  const url   = tab.url || '';
  const display = url.replace(/^https?:\/\//, '').slice(0, 48) + (url.length > 60 ? '...' : '');
  urlText.textContent = display;

  const isXPage = /x\.com\/|twitter\.com\//.test(url);

  if (isXPage) {
    const ping = await ensureContentScript(activeTabId);
    if (ping && ping.hasArticle) {
      isArticlePage = true;
      urlBadge.classList.add('valid');
      enableButton();
    } else {
      warnBox.classList.add('show');
    }
  } else {
    warnBox.classList.add('show');
  }
})();

function enableButton() { convertBtn.disabled = false; }

async function ensureContentScript(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'PING' });
  } catch (_) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await chrome.tabs.sendMessage(tabId, { action: 'PING' });
    } catch (_) {
      return null;
    }
  }
}

// ─── Button Handler ───────────────────────────────────────────────────────────

convertBtn.addEventListener('click', async () => {
  if (!activeTabId || !isArticlePage) return;

  resultBanner.className = 'result-banner';
  progressArea.classList.add('show');
  convertBtn.disabled = true;
  btnText.textContent  = 'Working...';
  beginProgressRun();

  setPhase('scroll', 'pending');
  setPhase('extract', 'pending');
  setPhase('pdf', 'pending');
  updateBar('scroll', 0);

  try {
    const response = await chrome.tabs.sendMessage(activeTabId, {
      action: 'SCROLL_AND_EXTRACT',
      jobId: activeJobId,
    });

    if (!response || !response.ok) throw new Error(response?.error || 'No response from page.');

    currentPhaseIndex = Math.max(currentPhaseIndex, phaseOrder.indexOf('pdf'));
    setPhase('extract', 'done');
    setPhase('pdf', 'active');
    phaseLabel.textContent = 'Generating PDF...';

    const filename = await buildPDF(response.title, response.blocks);

    finishProgressRun();
    setPhase('pdf', 'done');
    updateBar('pdf', 100);
    phaseLabel.textContent = 'Done!';
    phasePct.textContent   = '100%';
    showSuccess('Downloaded: ' + filename);

  } catch (err) {
    resetProgressRun();
    showError(err.message);
  } finally {
    convertBtn.disabled = false;
    btnText.textContent  = 'Convert to PDF';
  }
});

// ─── Progress UI ──────────────────────────────────────────────────────────────

const phaseOrder = ['scroll', 'extract', 'pdf'];

function beginProgressRun() {
  activeJobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  currentPhaseIndex = 0;
  jobCompleted = false;
}

function finishProgressRun() {
  currentPhaseIndex = phaseOrder.length - 1;
  jobCompleted = true;
}

function resetProgressRun() {
  activeJobId = null;
  currentPhaseIndex = -1;
  jobCompleted = false;
}

function handleProgress(phase, value, jobId) {
  if (!activeJobId || jobCompleted || jobId !== activeJobId) return;

  const phaseIndex = phaseOrder.indexOf(phase);
  if (phaseIndex === -1 || phaseIndex < currentPhaseIndex) return;

  if (phase === 'scroll') {
    currentPhaseIndex = Math.max(currentPhaseIndex, phaseOrder.indexOf('scroll'));
    if (value === 0)   setPhase('scroll', 'active');
    if (value === 100) {
      setPhase('scroll', 'done');
      setPhase('extract', 'active');
      currentPhaseIndex = Math.max(currentPhaseIndex, phaseOrder.indexOf('extract'));
    }
    updateBar('scroll', value);
    phaseLabel.textContent = value < 100 ? 'Scrolling article...' : 'Loading content...';
  }
  if (phase === 'extract') {
    currentPhaseIndex = Math.max(currentPhaseIndex, phaseOrder.indexOf('extract'));
    if (value > 0)     setPhase('extract', 'active');
    if (value === 100) setPhase('extract', 'done');
    updateBar('extract', value);
    phaseLabel.textContent = 'Extracting text...';
  }
}

function updateBar(phase, value) {
  const idx = phaseOrder.indexOf(phase);
  if (idx === -1) return;

  const overall = Math.round(((idx + (value / 100)) / phaseOrder.length) * 100);
  const pct = (phase === 'pdf' && value === 100) ? 100 : Math.min(overall, 99);
  barFill.style.width  = pct + '%';
  phasePct.textContent = pct + '%';
}

function setPhase(phase, state) {
  const el = phaseSteps[phase];
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state === 'active') el.classList.add('active');
  if (state === 'done')   el.classList.add('done');
}

// ─── PDF Builder ──────────────────────────────────────────────────────────────

async function buildPDF(title, blocks) {
  if (typeof window.jspdf === 'undefined') {
    throw new Error('jsPDF library not loaded. Add lib/jspdf.umd.min.js — see README.');
  }

  const { jsPDF } = window.jspdf;

  const PAGE_W    = 210;
  const PAGE_H    = 297;
  const MARGIN_X  = 22;
  const MARGIN_Y  = 24;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  let totalPages = 1;

  // ── Typography scale ──────────────────────────────────────────────────────
  //   size       = font size in pt
  //   lineH      = line height multiplier (× size × 0.40 gives mm)
  //   spaceBefore/After = extra vertical gap in mm
  //   indent     = left indent in mm
  //   bullet     = prefix string for list items
  //   rule       = draw underline after heading
  const T = {
    title:      { size: 24, style: 'bold',      lineH: 1.15, spaceBefore: 0,   spaceAfter: 4,   rule: true  },
    h1:         { size: 20, style: 'bold',      lineH: 1.15, spaceBefore: 8,   spaceAfter: 3,   rule: true  },
    h2:         { size: 16, style: 'bold',      lineH: 1.2,  spaceBefore: 7,   spaceAfter: 2.5, rule: false },
    h3:         { size: 13, style: 'bold',      lineH: 1.2,  spaceBefore: 6,   spaceAfter: 1.5, rule: false },
    h4:         { size: 12, style: 'bold',      lineH: 1.2,  spaceBefore: 5,   spaceAfter: 1.5, rule: false },
    h5:         { size: 11, style: 'bolditalic',lineH: 1.2,  spaceBefore: 4,   spaceAfter: 1   },
    h6:         { size: 11, style: 'italic',    lineH: 1.2,  spaceBefore: 4,   spaceAfter: 1   },
    p:          { size: 11, style: 'normal',    lineH: 1.4,  spaceBefore: 0,   spaceAfter: 4   },
    blockquote: { size: 11, style: 'italic',    lineH: 1.4,  spaceBefore: 4,   spaceAfter: 4,   indent: 8  },
    li:         { size: 11, style: 'normal',    lineH: 1.4,  spaceBefore: 0,   spaceAfter: 2,   bullet: '  *  ' },
    pre:        { size: 9,  style: 'normal',    lineH: 1.3,  spaceBefore: 3,   spaceAfter: 3   },
    figcaption: { size: 9,  style: 'italic',    lineH: 1.3,  spaceBefore: 1,   spaceAfter: 2   },
  };

  let cursorY = MARGIN_Y;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function lineHeight(sizeInPt, multiplier) {
    // Convert pt to mm: 1pt = 0.3528mm, then apply multiplier
    return sizeInPt * 0.3528 * multiplier;
  }

  function checkPage(needed) {
    if (cursorY + needed > PAGE_H - MARGIN_Y - 8) {
      doc.addPage();
      totalPages++;
      cursorY = MARGIN_Y;
    }
  }

  function drawRule(y, color) {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  }

  function renderBlock(type, text) {
    const s      = T[type] || T.p;
    const indent = s.indent  || 0;
    const prefix = s.bullet  || '';
    const lh     = lineHeight(s.size, s.lineH);
    const effW   = CONTENT_W - indent;

    doc.setFontSize(s.size);
    doc.setFont('helvetica', s.style);
    doc.setTextColor(20, 20, 25);

    const fullText = prefix + text;
    const lines    = doc.splitTextToSize(fullText, effW);

    // Space before (skip for very first block)
    if (s.spaceBefore > 0 && cursorY > MARGIN_Y + 2) {
      cursorY += s.spaceBefore;
    }

    // Check if block fits on page (approximate)
    checkPage(lines.length * lh + s.spaceAfter + 4);

    // Blockquote left rule
    if (type === 'blockquote') {
      const ruleH = lines.length * lh + 2;
      doc.setFillColor(79, 142, 247);
      doc.rect(MARGIN_X, cursorY - lh + 2, 2.5, ruleH, 'F');
    }

    // Render each line
    for (const line of lines) {
      checkPage(lh + 2);
      doc.text(line, MARGIN_X + indent, cursorY);
      cursorY += lh;
    }

    // Underline rule after title / h1
    if (s.rule) {
      cursorY += 1.5;
      drawRule(cursorY, type === 'title' ? [79, 142, 247] : [200, 200, 210]);
      cursorY += 2;
    }

    cursorY += s.spaceAfter;
  }

  // ── Decorative top bar ────────────────────────────────────────────────────
  doc.setFillColor(79, 142, 247);
  doc.rect(0, 0, PAGE_W, 5, 'F');
  cursorY = MARGIN_Y;

  // ── TITLE — large bold heading at very top ────────────────────────────────
  renderBlock('title', title);

  // ── Article body blocks ───────────────────────────────────────────────────
  for (const block of blocks) {
    renderBlock(block.type, block.text);
  }

  // ── Page numbers ──────────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(160, 160, 170);
    // Footer rule
    doc.setDrawColor(220, 220, 230);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, PAGE_H - 10, PAGE_W - MARGIN_X, PAGE_H - 10);
    // Source note
    doc.text('Exported via X Article -> PDF Extension', MARGIN_X, PAGE_H - 6);
    // Page number
    doc.text('Page ' + i + ' of ' + pageCount, PAGE_W - MARGIN_X - 20, PAGE_H - 6);
  }

  // ── Filename + download ───────────────────────────────────────────────────
  const safeName = title
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  const filename = (safeName || 'X_Article') + '.pdf';
  doc.save(filename);
  return filename;
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function showSuccess(msg) {
  resultBanner.className = 'result-banner success show';
  resultIcon.innerHTML   = '<polyline points="20 6 9 17 4 12" stroke-width="2.5" stroke-linecap="round"/>';
  resultText.textContent = msg;
  barFill.style.width    = '100%';
  phasePct.textContent   = '100%';
}

function showError(msg) {
  resultBanner.className = 'result-banner error show';
  resultIcon.innerHTML   = '<line x1="18" y1="6" x2="6" y2="18" stroke-width="2.5"/><line x1="6" y1="6" x2="18" y2="18" stroke-width="2.5"/>';
  resultText.textContent = msg;
  progressArea.classList.remove('show');
}
