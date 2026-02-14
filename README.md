# OnlyFans Duration Viewer (Browser Extension)

Shows duration/length of locked content by reading the page's API responses and displaying a small overlay.

## Install (Chrome / Edge)

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder (the one containing `manifest.json`)

## Files

- `manifest.json`: extension manifest (MV3)
- `content.js`: content script (UI overlay + click matching)
- `page-hook.js`: injected page hook (captures API responses)
- `overlay.css`: overlay styling

## Debug

In DevTools console (on onlyfans.com), run:

```js
window.__OF_DURATION_VIEWER_SET_DEBUG__(true)
```

## CI

GitHub Actions runs a small preflight on pushes/PRs:

- JS syntax check (`node --check`)
- `manifest.json` parse/validation
