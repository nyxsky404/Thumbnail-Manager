import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Save,
  Plus,
  X,
} from "lucide-react";
import type Konva from "konva";
import { useEditorStore } from "../stores/editorStore";
import { Canvas } from "../components/Canvas";
import { MissingFontsBanner } from "../components/MissingFontsBanner";
import { PropertiesPanel } from "../components/PropertiesPanel";
import { loadAllCustomFonts, loadGoogleFont } from "../lib/fonts";
import { sanitizeFilename } from "../lib/utils";
import { FALLBACK_GOOGLE_FONTS } from "../lib/constants";

/**
 * Compact autosave status pill shown in the editor header.
 *   - in-flight save     → "Saving..." (spinner)
 *   - dirty, idle        → "Unsaved" (will autosave on next debounce tick)
 *   - clean + lastSavedAt → "Saved" / "Saved Ns ago"
 *   - hasError           → renders nothing here (error banner handles it)
 *   - never saved + clean → renders nothing (no noise on initial load)
 */
function SaveStatus({
  saving,
  dirty,
  lastSavedAt,
  hasError,
}: {
  saving: boolean;
  dirty: boolean;
  lastSavedAt: number | null;
  hasError: boolean;
}) {
  // Re-render every 15s so "Saved Ns ago" stays roughly accurate without
  // setting a tight interval.
  const [, force] = useState(0);
  useEffect(() => {
    if (!lastSavedAt || saving || dirty) return;
    const id = window.setInterval(() => force((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, [lastSavedAt, saving, dirty]);

  if (hasError) return null;

  if (saving) {
    return (
      <span className="ml-2 flex items-center gap-1 rounded bg-blue-500/20 text-blue-300 px-2 py-0.5 text-xs">
        <Loader2 size={11} className="animate-spin" />
        Saving...
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="ml-2 rounded bg-yellow-500/20 text-yellow-400 px-2 py-0.5 text-xs">
        Unsaved
      </span>
    );
  }
  if (lastSavedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000));
    let label = "Saved";
    if (seconds >= 5 && seconds < 60) label = `Saved ${seconds}s ago`;
    else if (seconds >= 60) label = `Saved ${Math.floor(seconds / 60)}m ago`;
    return (
      <span className="ml-2 flex items-center gap-1 rounded bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-xs">
        <Check size={11} />
        {label}
      </span>
    );
  }
  return null;
}

export function Editor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const stageRef = useRef<Konva.Stage>(null);

  const template = useEditorStore((s) => s.template);
  const dirty = useEditorStore((s) => s.dirty);
  const saving = useEditorStore((s) => s.saving);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const error = useEditorStore((s) => s.error);
  const load = useEditorStore((s) => s.load);
  const reset = useEditorStore((s) => s.reset);
  const save = useEditorStore((s) => s.save);
  const setName = useEditorStore((s) => s.setName);
  const addText = useEditorStore((s) => s.addText);
  const clearError = useEditorStore((s) => s.clearError);

  const [fontsLoading, setFontsLoading] = useState(true);

  useEffect(() => {
    if (id) load(id);
    return () => reset();
  }, [id, load, reset]);

  // Preload fonts referenced by current elements + custom fonts on template
  // load. We only BLOCK on what's actually rendered on the canvas; the
  // fallback picker fonts are preloaded fire-and-forget so the editor never
  // waits on them. A hard ceiling guarantees the spinner can't get stuck.
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    setFontsLoading(true);

    const customNames = new Set(template.custom_fonts.map((f) => f.family));
    const usedFamilies = new Set<string>(["Roboto"]); // default
    for (const el of template.config_json.elements) {
      if (!customNames.has(el.fontFamily)) usedFamilies.add(el.fontFamily);
    }

    const blocking = Promise.all([
      loadAllCustomFonts(template.custom_fonts),
      ...Array.from(usedFamilies).map((f) => loadGoogleFont(f, 400)),
    ]);
    // Hard ceiling so we never sit on the spinner indefinitely.
    const ceiling = new Promise<void>((res) => window.setTimeout(res, 30000));

    Promise.race([blocking, ceiling]).then(() => {
      if (!cancelled) setFontsLoading(false);
    });

    // Background preload of picker fallback fonts — does NOT gate UI.
    for (const f of FALLBACK_GOOGLE_FONTS.slice(0, 5)) {
      loadGoogleFont(f, 400).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [template?.id]);

  // Block in-app navigation when dirty
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      const ok = confirm("You have unsaved changes. Leave anyway?");
      if (ok) blocker.proceed?.();
      else blocker.reset?.();
    }
  }, [blocker]);

  // Block tab close
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Save shortcut (Cmd/Ctrl + S) — bypasses the autosave debounce so users
  // who explicitly hit Save flush immediately rather than waiting.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirty, saving, save]);

  // Autosave: whenever the template is dirty, schedule a save after a brief
  // window of inactivity. Watching `template` (which gets a new reference on
  // every edit) re-arms the timer on each keystroke / drag tick / slider
  // change, so we only fire once the user pauses.
  //
  // We deliberately depend on `saving` so that when an in-flight save
  // resolves, the effect re-runs; if `dirty` is still true (because the user
  // edited mid-flight) it'll schedule the next pass automatically.
  //
  // We also pause autosave while there's an unresolved error, otherwise the
  // failing request would loop on every edit. The user dismissing the error
  // (or hitting Save manually) will resume the loop.
  useEffect(() => {
    if (!template || !dirty || saving || error) return;
    const AUTOSAVE_DELAY_MS = 1500;
    const handle = window.setTimeout(() => {
      save();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [template, dirty, saving, error, save]);

  function downloadPng() {
    if (!stageRef.current || !template) return;
    const dataUrl = stageRef.current.toDataURL({ pixelRatio: 1 / (stageRef.current.scaleX() || 1) });
    // Note: stage is scaled to fit — using inverse scale gives original canvas dims
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${sanitizeFilename(template.name)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  if (!template) {
    return (
      <div className="flex h-screen items-center justify-center">
        {error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="flex items-center gap-2 text-neutral-400">
            <Loader2 className="animate-spin" size={16} /> Loading template...
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
        <button
          onClick={() => navigate("/")}
          className="rounded p-1.5 hover:bg-neutral-800"
          title="Back to dashboard"
        >
          <ArrowLeft size={18} />
        </button>
        <input
          value={template.name}
          onChange={(e) => setName(e.target.value)}
          className="rounded bg-transparent px-2 py-1 text-sm font-medium hover:bg-neutral-800 focus:bg-neutral-800 focus:outline-none w-64"
        />
        <span className="text-xs text-neutral-500">
          {template.preset} · {template.canvas_width}×{template.canvas_height}
        </span>
        {fontsLoading && (
          <span className="flex items-center gap-1 text-xs text-neutral-400">
            <Loader2 size={12} className="animate-spin" /> Loading fonts...
          </span>
        )}
        <SaveStatus
          saving={saving}
          dirty={dirty}
          lastSavedAt={lastSavedAt}
          hasError={!!error}
        />

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={addText}
            className="flex items-center gap-1 rounded bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm"
          >
            <Plus size={14} /> Add Text
          </button>
          <button
            onClick={downloadPng}
            className="flex items-center gap-1 rounded bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-sm"
          >
            <Download size={14} /> Download PNG
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="flex items-center gap-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-sm font-medium"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border-b border-red-800 px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="rounded p-1 text-red-300 hover:bg-red-900/50 hover:text-red-100"
            aria-label="Dismiss error"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <MissingFontsBanner />

      <div className="flex flex-1 min-h-0">
        <Canvas stageRef={stageRef} fontsLoading={fontsLoading} />
        <PropertiesPanel />
      </div>
    </div>
  );
}
