import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Search, Trash2, Upload } from "lucide-react";
import { useEditorStore } from "../stores/editorStore";
import {
  fetchGoogleFontList,
  loadGoogleFont,
  loadCustomFont,
} from "../lib/fonts";
import { api } from "../lib/api";

interface Props {
  value: string;
  onChange: (family: string) => void;
}

export function FontPicker({ value, onChange }: Props) {
  const template = useEditorStore((s) => s.template);
  const addFont = useEditorStore((s) => s.addCustomFont);
  const removeFont = useEditorStore((s) => s.removeCustomFont);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [googleFonts, setGoogleFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(true);
  const [fontsError, setFontsError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFamily, setUploadFamily] = useState("");
  const [uploadWeight, setUploadWeight] = useState(400);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFontsLoading(true);
    setFontsError(null);
    fetchGoogleFontList()
      .then((list) => {
        if (cancelled) return;
        setGoogleFonts(list);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load fonts";
        setFontsError(msg);
      })
      .finally(() => {
        if (!cancelled) setFontsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute portal position relative to viewport whenever dropdown opens or
  // the page scrolls/resizes.
  useLayoutEffect(() => {
    if (!open) return;
    function recompute() {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      // Match the trigger width so the dropdown never overflows left or right.
      // Apply a minimum so the list is usable even on very narrow triggers.
      const width = Math.max(r.width, 220);
      // Left-align to trigger; clamp so it doesn't escape the viewport.
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      const top = r.bottom + 4;
      setPos({ top, left, width });
    }
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  // Close on outside click (works through portal because we check both refs)
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        triggerRef.current && triggerRef.current.contains(target)
      ) return;
      if (
        dropdownRef.current && dropdownRef.current.contains(target)
      ) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const customFamilies = useMemo(() => {
    if (!template) return [];
    const names = new Set(template.custom_fonts.map((f) => f.family));
    return Array.from(names);
  }, [template]);

  // When searching, sort matches so prefix matches come first ("playwrite nz"
  // → "Playwrite NZ Guides" before "Playwrite ABC NZ-something"). Cap at 200
  // results to keep the dropdown responsive on the 1900+ font catalog.
  const SEARCH_CAP = 200;
  const BROWSE_CAP = 80;
  const { filteredGoogle, totalGoogleMatches } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return { filteredGoogle: googleFonts.slice(0, BROWSE_CAP), totalGoogleMatches: googleFonts.length };
    }
    const matches = googleFonts.filter((f) => f.toLowerCase().includes(q));
    matches.sort((a, b) => {
      const ai = a.toLowerCase().indexOf(q);
      const bi = b.toLowerCase().indexOf(q);
      if (ai !== bi) return ai - bi; // earlier-position match first
      return a.localeCompare(b);
    });
    return { filteredGoogle: matches.slice(0, SEARCH_CAP), totalGoogleMatches: matches.length };
  }, [googleFonts, query]);

  // Load the font *before* committing the family to the store. Updating
  // the store first causes Konva to repaint with the new family but the
  // fallback's glyph metrics, which manifests as clipped/wrong-width text
  // for a moment. Loading first keeps text rendered in the previous family
  // (which Konva already has metrics for) until the new face is fully
  // available.
  async function pickGoogle(family: string) {
    setOpen(false);
    try {
      await loadGoogleFont(family, 400);
    } catch (err) {
      console.error("Failed to load Google font:", err);
    }
    onChange(family);
  }

  async function pickCustom(family: string) {
    setOpen(false);
    if (template) {
      try {
        await Promise.all(
          template.custom_fonts
            .filter((f) => f.family === family)
            .map(loadCustomFont)
        );
      } catch (err) {
        console.error("Failed to load custom font:", err);
      }
    }
    onChange(family);
  }

  async function submitUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!template || !uploadFile || !uploadFamily.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const created = await api.uploadFont(template.id, {
        family: uploadFamily.trim(),
        weight: uploadWeight,
        file: uploadFile,
      });
      addFont(created);
      await loadCustomFont(created);
      setUploadFamily("");
      setUploadFile(null);
      setShowUpload(false);
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function deleteFamily(family: string) {
    if (!template) return;
    if (!confirm(`Delete custom font family "${family}" (all weights)?`)) return;
    const fonts = template.custom_fonts.filter((f) => f.family === family);
    for (const f of fonts) {
      try {
        await api.deleteFont(template.id, f.id);
        removeFont(f.id);
      } catch (err) {
        console.error(err);
      }
    }
  }

  const dropdown = open && pos ? (
    <div
      ref={dropdownRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: pos.width,
        zIndex: 9999,
      }}
      className="max-h-96 overflow-hidden rounded-md bg-neutral-900 border border-neutral-700 shadow-xl flex flex-col"
    >
      <div className="p-2 border-b border-neutral-800">
        <div className="flex items-center gap-1 rounded bg-neutral-800 px-2">
          <Search size={14} className="text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              googleFonts.length > 0
                ? `Search ${googleFonts.length.toLocaleString()} Google Fonts...`
                : "Search Google Fonts..."
            }
            className="w-full bg-transparent py-1.5 text-sm focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-auto">
        <div className="px-2 py-1.5 flex items-center justify-between sticky top-0 bg-neutral-900 border-b border-neutral-800">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">
            Custom Fonts
          </span>
          <button
            type="button"
            onClick={() => setShowUpload((s) => !s)}
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
          >
            <Upload size={12} /> Upload
          </button>
        </div>

        {showUpload && (
          <form
            onSubmit={submitUpload}
            className="p-2 bg-neutral-950 border-b border-neutral-800 space-y-2"
          >
            <input
              required
              placeholder="Family name"
              value={uploadFamily}
              onChange={(e) => setUploadFamily(e.target.value)}
              className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs"
            />
            <div className="flex gap-2">
              <select
                value={uploadWeight}
                onChange={(e) => setUploadWeight(Number(e.target.value))}
                className="rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs"
              >
                {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
              <input
                type="file"
                accept=".ttf,.otf"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                className="flex-1 text-xs"
              />
            </div>
            {uploadError && (
              <div className="text-xs text-red-400">{uploadError}</div>
            )}
            <button
              type="submit"
              disabled={!uploadFile || !uploadFamily.trim() || uploading}
              className="w-full rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-2 py-1 text-xs"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </form>
        )}

        {customFamilies.length === 0 && !showUpload && (
          <div className="px-2 py-2 text-xs text-neutral-500">
            No custom fonts yet.
          </div>
        )}
        {customFamilies.map((fam) => (
          <div
            key={fam}
            className={`group flex items-center justify-between px-2 py-1.5 hover:bg-neutral-800 cursor-pointer text-sm ${
              value === fam ? "bg-blue-900/30" : ""
            }`}
            onClick={() => pickCustom(fam)}
          >
            <span className="truncate">{fam}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                deleteFamily(fam);
              }}
              className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-400"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        <div className="px-2 py-1.5 sticky top-0 bg-neutral-900 border-y border-neutral-800 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">
            Google Fonts
          </span>
          {fontsLoading && (
            <span className="flex items-center gap-1 text-[10px] text-neutral-400">
              <Loader2 size={10} className="animate-spin" />
              Loading
            </span>
          )}
          {!fontsLoading && !fontsError && (
            <span className="text-[10px] text-neutral-500 tabular-nums">
              {query ? (
                filteredGoogle.length < totalGoogleMatches
                  ? `Showing ${filteredGoogle.length} of ${totalGoogleMatches}`
                  : `${totalGoogleMatches} match${totalGoogleMatches === 1 ? "" : "es"}`
              ) : (
                `Top ${filteredGoogle.length} of ${googleFonts.length} — search for more`
              )}
            </span>
          )}
        </div>

        {fontsLoading && googleFonts.length === 0 && (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-neutral-400">
            <Loader2 size={12} className="animate-spin" />
            Loading Google Fonts catalog...
          </div>
        )}

        {!fontsLoading && fontsError && (
          <div className="px-2 py-3 text-xs text-red-400">
            Couldn't load Google Fonts: {fontsError}
          </div>
        )}

        {!fontsLoading && !fontsError && filteredGoogle.length === 0 && (
          <div className="px-2 py-3 text-xs text-neutral-500">
            {query
              ? `No fonts match "${query}".`
              : "No Google fonts available."}
          </div>
        )}

        {filteredGoogle.map((f) => (
          <div
            key={f}
            onClick={() => pickGoogle(f)}
            className={`px-2 py-1.5 hover:bg-neutral-800 cursor-pointer text-sm ${
              value === f ? "bg-blue-900/30" : ""
            }`}
          >
            {f}
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between rounded bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-sm hover:border-neutral-600"
      >
        <span className="truncate">{value || "Select font"}</span>
        <ChevronDown size={14} />
      </button>
      {dropdown && createPortal(dropdown, document.body)}
    </div>
  );
}
