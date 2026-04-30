import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { X, Upload } from "lucide-react";
import { useTemplatesStore } from "../stores/templatesStore";
import { PRESET_DIMENSIONS } from "../lib/constants";
import type { CanvasPreset } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

/**
 * Read the dimensions of an uploaded PNG or PSD without sending it to the
 * server, then pick the preset whose orientation matches.
 *
 *   - PNG: load via `<img>` and read `naturalWidth` / `naturalHeight`.
 *   - PSD: parse the 26-byte fixed-size header. Layout (big-endian):
 *           0..3   magic = "8BPS"
 *           4..5   version (1 = PSD)
 *           6..11  reserved (zeros)
 *           12..13 number of channels
 *           14..17 height (uint32)
 *           18..21 width  (uint32)
 *
 * Returns `null` on any error so the caller can keep its current preset.
 */
async function detectAspectPreset(file: File): Promise<CanvasPreset | null> {
  try {
    let w = 0;
    let h = 0;
    if (/\.psd$/i.test(file.name)) {
      const buf = await file.slice(0, 26).arrayBuffer();
      const dv = new DataView(buf);
      const magic = String.fromCharCode(
        dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)
      );
      if (magic !== "8BPS") return null;
      h = dv.getUint32(14, false);
      w = dv.getUint32(18, false);
    } else {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error("image decode failed"));
          im.src = url;
        });
        w = img.naturalWidth;
        h = img.naturalHeight;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (!w || !h) return null;
    // Square or wider → 16:9 (landscape). Taller than wide → 9:16 (portrait).
    return w >= h ? "16:9" : "9:16";
  } catch {
    return null;
  }
}

export function UploadModal({ open, onClose, onCreated }: Props) {
  const create = useTemplatesStore((s) => s.create);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<CanvasPreset>("16:9");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // We accept PNG and PSD. The backend dispatches by magic bytes, so the
  // accept hint here is purely a UX nicety — OS file pickers will filter to
  // these extensions but the server still validates.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/png": [".png"],
      // PSDs are reported under several MIME strings depending on the OS;
      // also include the literal extension so dropzone matches files whose
      // browser-reported type is the generic application/octet-stream.
      "image/vnd.adobe.photoshop": [".psd"],
      "application/octet-stream": [".psd"],
    },
    maxFiles: 1,
    onDrop: async (files) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      if (!name) setName(f.name.replace(/\.(png|psd)$/i, ""));
      // Auto-pick the preset whose orientation matches the file. We only
      // *suggest* — the user can still click the other preset to override.
      const detected = await detectAspectPreset(f);
      if (detected) setPreset(detected);
    },
  });

  const isPsd = !!file && /\.psd$/i.test(file.name);

  if (!open) return null;

  const dim = PRESET_DIMENSIONS[preset];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const t = await create({ name: name.trim(), preset, file });
      onCreated?.(t.id);
      onClose();
      setName("");
      setFile(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl bg-neutral-900 p-6 shadow-xl border border-neutral-800"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New Template</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200"
          >
            <X size={20} />
          </button>
        </div>

        <label className="block text-sm mb-1 text-neutral-400">Template Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full mb-4 rounded bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="e.g. Tech News Thumbnail"
        />

        <label className="block text-sm mb-1 text-neutral-400">Canvas Preset</label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(["16:9", "9:16"] as CanvasPreset[]).map((p) => {
            const d = PRESET_DIMENSIONS[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className={`rounded border px-3 py-2 text-left ${
                  preset === p
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-neutral-700 bg-neutral-800 hover:border-neutral-600"
                }`}
              >
                <div className="font-medium text-sm">{p}</div>
                <div className="text-xs text-neutral-400">
                  {d.width}×{d.height}
                </div>
              </button>
            );
          })}
        </div>

        <label className="block text-sm mb-1 text-neutral-400">Background image</label>
        <div
          {...getRootProps()}
          className={`mb-1 cursor-pointer rounded border-2 border-dashed p-6 text-center ${
            isDragActive
              ? "border-blue-500 bg-blue-500/10"
              : "border-neutral-700 bg-neutral-800/50"
          }`}
        >
          <input {...getInputProps()} />
          <Upload size={28} className="mx-auto mb-2 text-neutral-500" />
          {file ? (
            <div className="text-sm">
              {file.name}
              {isPsd && (
                <span className="ml-2 rounded bg-purple-500/20 text-purple-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  PSD
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm text-neutral-400">
              Drop a PNG or PSD here, or click to browse
            </div>
          )}
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          {isPsd ? (
            <>
              We’ll flatten the PSD to {dim.width}×{dim.height} and import its text
              layers as editable elements. Layers using fonts we don’t have will
              fall back to Roboto — you can upload custom fonts from the editor.
            </>
          ) : (
            <>
              Upload PNG (≤ 10 MB) or PSD (≤ 50 MB). For best results, match the
              preset size {dim.width}×{dim.height} ({preset}).
            </>
          )}
        </p>

        {error && (
          <div className="mb-3 rounded bg-red-900/40 border border-red-800 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!file || !name.trim() || submitting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (isPsd ? "Parsing PSD..." : "Uploading...") : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
