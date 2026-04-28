"use strict";

/**
 * Maps each browser MIME type to the Windows CF_* format(s) it corresponds to,
 * along with notes about fidelity.
 */
const MIME_TO_WIN = {
  "text/plain": {
    winFormats: ["CF_TEXT", "CF_UNICODETEXT"],
    note: "Browser exposes Unicode text. Equivalent to both CF_TEXT (ANSI) and CF_UNICODETEXT.",
  },
  "text/html": {
    winFormats: ["HTML Format"],
    note: "Registered (non-standard) clipboard format. Not a raw CF_ integer constant, but this is how HTML clipboard data is stored on Windows.",
  },
  "image/png": {
    winFormats: ["CF_BITMAP", "CF_DIB", "CF_DIBV5"],
    note: "Browser converts bitmap data to PNG. The original CF_BITMAP/CF_DIB pixel dimensions and color depth are preserved.",
  },
  "image/jpeg": {
    winFormats: ["CF_BITMAP (JPEG source)"],
    note: "Returned as JPEG by the browser. Corresponds to a CF_BITMAP-derived rasterization.",
  },
  "image/gif": {
    winFormats: ["CF_BITMAP (GIF source)"],
    note: "Returned as GIF by the browser.",
  },
  "image/svg+xml": {
    winFormats: ["SVG (registered format)"],
    note: "SVG clipboard data placed by some applications.",
  },
  "text/uri-list": {
    winFormats: ["CF_HDROP (URL variant)"],
    note: "URI list; partially overlaps with CF_HDROP for URL drag/drop.",
  },
  files: {
    winFormats: ["CF_HDROP"],
    note: "File objects available via paste event. The browser exposes name, size, and type but not the raw absolute file paths that CF_HDROP provides natively.",
  },
};

/**
 * Windows CF_* formats that are NOT accessible from a normal browser page,
 * with an explanation of the restriction.
 */
const INACCESSIBLE_WIN_FORMATS = [
  {
    id: "CF_ENHMETAFILE",
    value: 14,
    reason:
      "Requires Win32 GetClipboardData(CF_ENHMETAFILE) to obtain an HENHMETAFILE handle. The browser sandbox has no Win32 clipboard API access.",
  },
  {
    id: "CF_METAFILEPICT",
    value: 3,
    reason:
      "Requires Win32 GetClipboardData(CF_METAFILEPICT) and a METAFILEPICT struct. Not exposed to any browser API.",
  },
  {
    id: "CF_LOCALE",
    value: 16,
    reason:
      "An HGLOBAL handle to an LCID. Automatically set by Windows when CF_TEXT is placed. Not surfaced through any browser clipboard interface.",
  },
];

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function $(id) {
  return document.getElementById(id);
}

function clearResults() {
  $("results").innerHTML = "";
  $("coverage-body").innerHTML = "";
  $("status").textContent = "";
  $("coverage-section").hidden = true;
}

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "status error" : "status";
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function renderTextPlain(blob) {
  return blob.text().then((text) => {
    const pre = document.createElement("pre");
    pre.className = "content-pre";
    pre.textContent = text || "(empty)";
    return pre;
  });
}

function renderTextHtml(blob) {
  return blob.text().then((html) => {
    const wrapper = document.createElement("div");
    wrapper.className = "html-wrapper";

    // Rendered preview in a sandboxed iframe
    const iframe = document.createElement("iframe");
    iframe.className = "html-preview";
    iframe.setAttribute("sandbox", "");
    iframe.setAttribute("title", "HTML clipboard preview");
    iframe.srcdoc = html;
    wrapper.appendChild(iframe);

    // Source view
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "View raw HTML source";
    const pre = document.createElement("pre");
    pre.className = "content-pre source";
    pre.textContent = html;
    details.appendChild(summary);
    details.appendChild(pre);
    wrapper.appendChild(details);

    return wrapper;
  });
}

function renderImage(blob, mimeType) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = document.createElement("img");
    img.className = "content-image";
    img.alt = `Clipboard image (${mimeType})`;
    img.src = url;
    img.onload = () => {
      const meta = document.createElement("p");
      meta.className = "image-meta";
      meta.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${(blob.size / 1024).toFixed(1)} KB · ${mimeType}`;
      const wrapper = document.createElement("div");
      wrapper.appendChild(img);
      wrapper.appendChild(meta);
      resolve(wrapper);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const p = document.createElement("p");
      p.textContent = "Could not render image.";
      resolve(p);
    };
  });
}

function renderFiles(fileList) {
  const ul = document.createElement("ul");
  ul.className = "file-list";
  if (fileList.length === 0) {
    const li = document.createElement("li");
    li.textContent = "(no files)";
    ul.appendChild(li);
  }
  for (const f of fileList) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${escapeHtml(f.name)}</strong> — ${(f.size / 1024).toFixed(1)} KB · <em>${escapeHtml(f.type || "unknown type")}</em>`;
    ul.appendChild(li);
  }

  const note = document.createElement("p");
  note.className = "format-note";
  note.textContent =
    "⚠ File paths (CF_HDROP) are not exposed — the browser only provides name, size, and type.";
  const wrapper = document.createElement("div");
  wrapper.appendChild(ul);
  wrapper.appendChild(note);
  return wrapper;
}

function renderGeneric(blob, mimeType) {
  return blob.arrayBuffer().then((buf) => {
    const wrapper = document.createElement("div");
    const p = document.createElement("p");
    p.className = "format-note";
    p.textContent = `Binary data · ${buf.byteLength} bytes · MIME type: ${mimeType}`;
    wrapper.appendChild(p);

    // Offer a download
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clipboard.${mimeType.split("/")[1] || "bin"}`;
    a.className = "download-btn";
    a.textContent = "Download raw data";
    wrapper.appendChild(a);
    return wrapper;
  });
}

async function renderBlob(blob, mimeType) {
  if (mimeType === "text/plain") return renderTextPlain(blob);
  if (mimeType === "text/html") return renderTextHtml(blob);
  if (mimeType.startsWith("image/")) return renderImage(blob, mimeType);
  return renderGeneric(blob, mimeType);
}

// ---------------------------------------------------------------------------
// Coverage table
// ---------------------------------------------------------------------------

function buildCoverageTable(seenMimeTypes, hasFiles) {
  const tbody = $("coverage-body");
  tbody.innerHTML = "";

  // Accessible formats
  const accessibleRows = [
    {
      winFormat: "CF_TEXT / CF_UNICODETEXT",
      value: "1 / 13",
      mimeType: "text/plain",
      accessible: seenMimeTypes.has("text/plain"),
      note: "Plain text",
    },
    {
      winFormat: "HTML Format",
      value: "registered",
      mimeType: "text/html",
      accessible: seenMimeTypes.has("text/html"),
      note: "Rich text as HTML",
    },
    {
      winFormat: "CF_BITMAP / CF_DIB",
      value: "2 / 8",
      mimeType: "image/png",
      accessible: seenMimeTypes.has("image/png") || seenMimeTypes.has("image/jpeg") || seenMimeTypes.has("image/gif"),
      note: "Image data (browser converts to PNG/JPEG/GIF)",
    },
    {
      winFormat: "CF_HDROP",
      value: "15",
      mimeType: "Files (paste event)",
      accessible: hasFiles,
      note: "File list — paths hidden by browser",
      partial: true,
    },
  ];

  for (const row of accessibleRows) {
    const tr = document.createElement("tr");
    let statusCell;
    if (!row.accessible) {
      statusCell = `<td class="status-cell unavail">✗ Not present</td>`;
    } else if (row.partial) {
      statusCell = `<td class="status-cell partial">⚠ Partial</td>`;
    } else {
      statusCell = `<td class="status-cell avail">✓ Available</td>`;
    }
    tr.innerHTML = `
      <td><code>${row.winFormat}</code></td>
      <td>${row.value}</td>
      <td><code>${row.mimeType}</code></td>
      ${statusCell}
      <td>${row.note}</td>`;
    tbody.appendChild(tr);
  }

  // Inaccessible formats (always blocked)
  for (const fmt of INACCESSIBLE_WIN_FORMATS) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${fmt.id}</code></td>
      <td>${fmt.value}</td>
      <td><em>N/A</em></td>
      <td class="status-cell blocked">⛔ Blocked</td>
      <td>${fmt.reason}</td>`;
    tbody.appendChild(tr);
  }

  $("coverage-section").hidden = false;
}

// ---------------------------------------------------------------------------
// Paste event handler
// ---------------------------------------------------------------------------

function handlePaste(e) {
  e.preventDefault();
  clearResults();

  const dt = e.clipboardData;
  if (!dt) return;

  const results = $("results");
  const seenMimeTypes = new Set();
  let hasFiles = false;

  // Files
  if (dt.files && dt.files.length > 0) {
    hasFiles = true;
    seenMimeTypes.add("files");
    const section = document.createElement("section");
    section.className = "item-section";
    const header = document.createElement("div");
    header.className = "format-header";
    const mime = document.createElement("span");
    mime.className = "mime-badge";
    mime.textContent = "Files (CF_HDROP)";
    header.appendChild(mime);
    const winInfo = MIME_TO_WIN["files"];
    if (winInfo) {
      for (const wf of winInfo.winFormats) {
        const b = document.createElement("span");
        b.className = "win-badge";
        b.textContent = wf;
        header.appendChild(b);
      }
    }
    section.appendChild(header);
    const contentDiv = document.createElement("div");
    contentDiv.className = "format-content";
    contentDiv.appendChild(renderFiles(dt.files));
    section.appendChild(contentDiv);
    results.appendChild(section);
  }

  // DataTransfer items — use dt.items so image blobs are accessible via getAsFile()
  const items = Array.from(dt.items || []);
  for (const item of items) {
    // Skip file-kind items that are not images (already handled as CF_HDROP above)
    if (item.kind === "file" && !item.type.startsWith("image/")) continue;

    const type = item.type;
    if (!type || type === "Files") continue;
    seenMimeTypes.add(type);

    const section = document.createElement("section");
    section.className = "item-section";

    // Format header with MIME + Windows CF_* badges
    const header = document.createElement("div");
    header.className = "format-header";
    const mimeBadge = document.createElement("span");
    mimeBadge.className = "mime-badge";
    mimeBadge.textContent = type;
    header.appendChild(mimeBadge);

    const winInfo = MIME_TO_WIN[type];
    if (winInfo) {
      for (const wf of winInfo.winFormats) {
        const b = document.createElement("span");
        b.className = "win-badge";
        b.textContent = wf;
        header.appendChild(b);
      }
    }
    section.appendChild(header);

    const contentDiv = document.createElement("div");
    contentDiv.className = "format-content";

    if (item.kind === "file" && type.startsWith("image/")) {
      // Image — render preview + download button
      const file = item.getAsFile();
      if (file) {
        const url = URL.createObjectURL(file);
        const img = document.createElement("img");
        img.className = "content-image";
        img.alt = `Clipboard image (${type})`;
        img.src = url;
        img.onload = () => {
          meta.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${(file.size / 1024).toFixed(1)} KB · ${type}`;
        };

        const meta = document.createElement("p");
        meta.className = "image-meta";
        meta.textContent = `${(file.size / 1024).toFixed(1)} KB · ${type}`;

        const ext = type.split("/")[1] || "bin";
        const dlUrl = URL.createObjectURL(file);
        const dl = document.createElement("a");
        dl.href = dlUrl;
        dl.download = `clipboard-image.${ext}`;
        dl.className = "download-btn";
        dl.textContent = `Download ${ext.toUpperCase()}`;

        contentDiv.appendChild(img);
        contentDiv.appendChild(meta);
        contentDiv.appendChild(dl);
      } else {
        const p = document.createElement("p");
        p.className = "format-note error";
        p.textContent = "Could not read image data from clipboard item.";
        contentDiv.appendChild(p);
      }
    } else if (type === "text/html") {
      const text = dt.getData(type);
      const iframe = document.createElement("iframe");
      iframe.className = "html-preview";
      iframe.setAttribute("sandbox", "");
      iframe.setAttribute("title", "HTML clipboard preview");
      iframe.srcdoc = text;
      contentDiv.appendChild(iframe);

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "View raw HTML source";
      const pre = document.createElement("pre");
      pre.className = "content-pre source";
      pre.textContent = text;
      details.appendChild(summary);
      details.appendChild(pre);
      contentDiv.appendChild(details);
    } else {
      const text = dt.getData(type);
      const pre = document.createElement("pre");
      pre.className = "content-pre";
      pre.textContent = text || "(empty)";
      contentDiv.appendChild(pre);
    }

    section.appendChild(contentDiv);
    results.appendChild(section);
  }

  const count = seenMimeTypes.size;
  setStatus(
    `Paste detected: ${count} data type${count !== 1 ? "s" : ""} found via paste event.`
  );
  buildCoverageTable(seenMimeTypes, hasFiles);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("paste", handlePaste);
});
