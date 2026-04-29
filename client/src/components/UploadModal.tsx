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

export function UploadModal({ open, onClose, onCreated }: Props) {
  const create = useTemplatesStore((s) => s.create);
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<CanvasPreset>("16:9");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/png": [".png"] },
    maxFiles: 1,
    onDrop: (files) => {
      if (files[0]) {
        setFile(files[0]);
        if (!name) setName(files[0].name.replace(/\.png$/i, ""));
      }
    },
  });

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

        <label className="block text-sm mb-1 text-neutral-400">Background PNG</label>
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
            <div className="text-sm">{file.name}</div>
          ) : (
            <div className="text-sm text-neutral-400">
              Drop a PNG here, or click to browse
            </div>
          )}
        </div>
        <p className="text-xs text-neutral-500 mb-4">
          For best results, upload a PNG at {dim.width}×{dim.height} ({preset}). Off-aspect images
          will be cropped (cover fit).
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
            {submitting ? "Uploading..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
