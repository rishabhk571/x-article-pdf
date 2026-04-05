# X Article → PDF  —  Browser Extension

A Microsoft Edge extension that scrolls an X (Twitter) Article to fully load
dynamic content, extracts only the text, and downloads a clean PDF — no images,
no X chrome, just the article.

---

## ⚡ One-Time Setup: Add jsPDF

The extension needs `jsPDF` as a local file. **Do this before loading the
extension.**

1. Download the UMD build from the official CDN:
   ```
   https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
   ```
2. Save it to the `lib/` folder inside this extension directory:
   ```
   x-article-pdf-extension/
   └── lib/
       └── jspdf.umd.min.js   ← place it here
   ```

> Alternatively run: `curl -o lib/jspdf.umd.min.js "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"`

---

## 🛠️ Installing in Microsoft Edge (Developer Mode)

1. **Open Extensions Manager**
   - In Edge, navigate to `edge://extensions/`
   - OR click the `⋯` menu → **Extensions** → **Manage Extensions**

2. **Enable Developer Mode**
   - Toggle **"Developer mode"** ON (bottom-left of the page)

3. **Load the Extension**
   - Click **"Load unpacked"**
   - Browse to and select the `x-article-pdf-extension/` folder
   - Click **Select Folder**

4. **Verify**
   - The extension "X Article → PDF" should appear in your list
   - Pin it to the toolbar: click the puzzle-piece icon → pin the extension

5. **Use it**
   - Navigate to any X Article: `https://x.com/i/articles/[id]`
   - Click the extension icon in the toolbar
   - Click **Convert to PDF** — the popup shows live progress
   - A PDF will download automatically when complete

---

## 📁 File Structure

```
x-article-pdf-extension/
├── manifest.json       MV3 manifest — permissions, content scripts
├── content.js          Injected into article pages; handles scroll + extract
├── background.js       Service worker; relays progress events to popup
├── popup.html          Extension popup UI
├── popup.js            Popup logic + jsPDF PDF generation
├── lib/
│   └── jspdf.umd.min.js  ← YOU MUST ADD THIS (see setup above)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png     (Optional — Edge uses default icon if absent)
```

---

## 🔍 How It Works

### Targeting X Article Selectors
X Articles live at `x.com/i/articles/<id>`. The extension tries a chain of
selectors to find the article root, starting from the most specific:
- `[data-testid="article"]`
- `article[role="article"]`
- `main article`
- `div[data-testid="primaryColumn"]`
- `main` (fallback)

Text is extracted from semantic tags (`h1`–`h6`, `p`, `blockquote`, `li`,
`pre`, `code`) while entire subtrees for `img`, `video`, `svg`, `nav`,
`aside`, and X-specific UI testids are skipped.

### Scroll Strategy
The auto-scroller uses `scrollBy` with random step sizes (200–520px) and
random delays (180–420ms) to mimic human reading patterns. A stall-detector
gives up if scrollHeight stops growing.

### PDF Generation
`jsPDF` receives the structured text array and renders each block with
typographic rules:
- Headings → larger bold fonts with spacing
- Blockquotes → italic with a blue left-rule
- Lists → bullet prefix
- Monospace blocks → smaller font

---

## 📝 Notes
- The extension only activates on `x.com/i/articles/*` pages.
- No data ever leaves your machine — everything runs locally.
- If the article has a paywall or login gate, the visible text is what gets exported.
