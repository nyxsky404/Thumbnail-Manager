import { useRef, useState } from "react";
import { AlertTriangle, Loader2, Upload, X } from "lucide-react";
import type { MissingFont } from "../types";
import { api } from "../lib/api";
import { loadCustomFont } from "../lib/fonts";
import { useEditorStore } from "../stores/editorStore";

/**
 * Banner shown above the canvas when a PSD-imported template still has
 * unresolved font references. Each missing font has its own row with a file
 * input that uploads a `.ttf` / `.otf` for that exact family. On a successful
 * upload we add the resulting custom font to the template, switch every
 * affected text element back to the original family name (it had been
 * temporarily forced to "Roboto" by the importer), and remove the row.
 *
 * The banner stays mounted as long as `missing_fonts` is non-empty. Hitting
 * "Dismiss all" simply clears the list — text elements stay on Roboto and
 * the user can reassign fonts from the Font Picker later if they want.
 */
export function MissingFontsBanner() {
  const template = useEditorStore((s) => s.template);
  const addCustomFont = useEditorStore((s) => s.addCustomFont);
  const resolveMissingFont = useEditorStore((s) => s.resolveMissingFont);
  const dismissMissingFonts = useEditorStore((s) => s.dismissMissingFonts);

  const missing = template?.config_json?.missing_fonts ?? [];
  if (!template || missing.length === 0) return null;

  return (
    <div className="border-b border-yellow-700/50 bg-yellow-500/10 px-4 py-2 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          className="mt-0.5 shrink-0 text-yellow-400"
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="text-yellow-100">
            {missing.length === 1
              ? `1 font from your PSD isn’t available — text using it is rendering in Roboto.`
              : `${missing.length} fonts from your PSD aren’t available — text using them is rendering in Roboto.`}
          </div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((m) => (
              <MissingFontRow
                key={`${m.family}:${m.weight}`}
                missing={m}
                templateId={template.id}
                onResolved={(font) => {
                  addCustomFont(font);
                  resolveMissingFont(m.family);
                }}
              />
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={dismissMissingFonts}
          className="ml-2 rounded p-1 text-yellow-300 hover:bg-yellow-500/20 hover:text-yellow-100"
          title="Dismiss all"
          aria-label="Dismiss all missing-font warnings"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function MissingFontRow({
  missing,
  templateId,
  onResolved,
}: {
  missing: MissingFont;
  templateId: string;
  onResolved: (font: import("../types").CustomFont) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // PSD weights are CSS-string ("700"); the upload endpoint wants a number.
  // Default to 400 if parsing fails (e.g. variable-weight fonts where we
  // recorded a non-standard token).
  const numericWeight = (() => {
    const n = parseInt(missing.weight, 10);
    return Number.isFinite(n) && n >= 100 && n <= 900 ? n : 400;
  })();

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const font = await api.uploadFont(templateId, {
        family: missing.family,
        weight: numericWeight,
        file,
      });
      // Ensure the FontFace is registered in `document.fonts` BEFORE we swap
      // the affected text elements back to this family. Otherwise Konva
      // repaints with the new family name but the system fallback's glyph
      // metrics, producing visibly clipped/wrong-width text until something
      // else triggers a re-render. `loadCustomFont` also dispatches
      // `frammar:fontloaded` so any cached glyph metrics are invalidated.
      await loadCustomFont(font);
      onResolved(font);
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const usedCount = missing.used_in_element_ids.length;

  return (
    <li className="flex items-center gap-2 rounded bg-yellow-500/15 border border-yellow-700/40 px-2 py-1">
      <span className="text-xs text-yellow-100">
        <strong className="font-medium">{missing.family}</strong>
        <span className="text-yellow-300/70 ml-1">
          {missing.weight} · {usedCount} {usedCount === 1 ? "layer" : "layers"}
        </span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = ""; // allow re-picking the same file after an error
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 rounded bg-yellow-500/30 hover:bg-yellow-500/40 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-0.5 text-xs text-yellow-50"
      >
        {uploading ? (
          <>
            <Loader2 size={11} className="animate-spin" />
            Uploading
          </>
        ) : (
          <>
            <Upload size={11} />
            Upload .ttf/.otf
          </>
        )}
      </button>
      {error && (
        <span className="text-xs text-red-300" title={error}>
          Failed
        </span>
      )}
    </li>
  );
}
