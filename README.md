# web-clippi

A browser-based Windows clipboard inspector. Paste any clipboard content and the page displays every data type the browser can access, mapped to the corresponding Windows `CF_*` format identifier.

Live at **[clippi.link](http://clippi.link)**

## Usage

Open the page, copy something to your clipboard, then press `Ctrl+V` anywhere on the page.

Supported clipboard content:

- Plain text — `CF_TEXT` / `CF_UNICODETEXT`
- Rich text / HTML — `HTML Format`
- Images — `CF_BITMAP` / `CF_DIB` (previewed and downloadable)
- Files — `CF_HDROP` (file names and sizes; full paths are blocked by the browser)

Formats that cannot be accessed from a browser page (`CF_ENHMETAFILE`, `CF_METAFILEPICT`, `CF_LOCALE`) are listed in the coverage table with an explanation of why they are blocked.

## Limitations

The browser Clipboard API does not provide access to raw Windows clipboard handles. All data is exposed as MIME-typed blobs. Formats requiring Win32 `GetClipboardData()` are inaccessible without a native host such as an Electron or Tauri app.

## Requirements

- Chrome or Edge 76+
- Served over HTTPS or `localhost` (required by the Clipboard API)

## Running locally

```
python -m http.server 5500
```

Then open `http://localhost:5500`.
