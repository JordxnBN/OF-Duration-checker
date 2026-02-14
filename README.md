# OnlyFans Duration Viewer (Browser Extension)

Shows duration/length of locked content by reading the page's API responses and displaying a small overlay.

Note: you must click a locked message to trigger the lookup and reveal the duration.

Current behavior: this build is **messages-only**. It works from the **Messages/DMs tab** (chat locked messages). It does not currently scan posts/feed pages.

To request “scan everywhere” support (posts/feed included), open an Issue with example URLs/endpoints, or submit a Pull Request implementing the change.

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
