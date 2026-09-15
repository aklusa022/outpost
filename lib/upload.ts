/**
 * Saves a cross-origin file under `name`. The `download` attribute is
 * ignored for cross-origin hrefs, so fetch the bytes (the bucket's CORS
 * allows GET from our origins) and hand the browser a same-origin blob.
 * Falls back to opening the URL in a new tab if the fetch is refused.
 */
export async function downloadFile(url: string, name: string): Promise<void> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the click a tick to start before revoking.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

/**
 * PUTs a file to a presigned R2 URL with upload progress. XHR rather than
 * fetch because fetch has no upload-progress events. Mirrors the helper
 * inside @convex-dev/r2 (which isn't exported), plus abort support.
 */
export function uploadToR2(
  url: string,
  file: File,
  options: {
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
