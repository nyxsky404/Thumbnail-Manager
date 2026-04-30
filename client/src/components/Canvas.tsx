import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Stage,
  Layer,
  Image as KImage,
  Group,
  Rect,
  Text,
  Transformer,
} from "react-konva";
import useImage from "use-image";
import type Konva from "konva";
import { Loader2 } from "lucide-react";
import { useEditorStore } from "../stores/editorStore";
import { customFontFamilyName, onFontLoaded } from "../lib/fonts";
import type { TextElement, CustomFont } from "../types";

interface Props {
  stageRef?: React.RefObject<Konva.Stage>;
  /**
   * When true, render a spinner overlay across the canvas area. Used during
   * the initial font preload so users don't see text flash in a fallback
   * font (Konva paints with the fallback metrics that were live at first
   * paint and only re-flows on the `fontVersion` bump after fonts load).
   */
  fontsLoading?: boolean;
}

function resolveFontFamily(el: TextElement, customFonts: CustomFont[]): string {
  const isCustom = customFonts.some((f) => f.family === el.fontFamily);
  return isCustom ? customFontFamilyName(el.fontFamily) : el.fontFamily;
}

function computeBackgroundCover(
  imgW: number,
  imgH: number,
  cw: number,
  ch: number
) {
  const scale = Math.max(cw / imgW, ch / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, width: w, height: h };
}

function TextNode({
  element,
  isSelected,
  isEditing,
  customFonts,
  fontVersion,
  onSelect,
  onChange,
  onStartEdit,
}: {
  element: TextElement;
  isSelected: boolean;
  isEditing: boolean;
  customFonts: CustomFont[];
  fontVersion: number;
  onSelect: () => void;
  onChange: (patch: Partial<TextElement>) => void;
  onStartEdit: () => void;
}) {
  const groupRef = useRef<Konva.Group>(null);
  const textRef = useRef<Konva.Text>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const reportedH = useRef(element.height);
  const isAuto = element.textSizing !== "fixed";

  useEffect(() => {
    if (isSelected && !isEditing && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, isEditing]);

  // When a Google/custom font finishes loading, Konva's cached glyph metrics
  // (computed against the fallback font during the initial paint) are stale.
  // Re-applying `fontFamily` triggers Konva's setter, which calls _setTextData
  // internally to recompute width/wrap, then we redraw the layer.
  useEffect(() => {
    const node = textRef.current;
    if (!node) return;
    node.fontFamily(node.fontFamily());
    node.getLayer()?.batchDraw();
  }, [fontVersion]);

  // Auto-height: when textSizing is "auto" (default), the Konva Text renders
  // without a height constraint so it never clips content. We read back the
  // natural height and sync it to the store so the Properties panel W/H
  // fields and the hit-test Rect always reflect the real bounding box.
  // reportedH tracks the last value we wrote so we avoid a render loop.
  useLayoutEffect(() => {
    if (!isAuto) return;
    const node = textRef.current;
    if (!node) return;
    const h = Math.ceil(node.height());
    if (Math.abs(h - reportedH.current) > 0.5) {
      reportedH.current = h;
      onChange({ height: h });
    }
  }, [element.text, element.fontFamily, element.fontSize, element.fontWeight,
      element.letterSpacing, element.lineHeight, element.width, isAuto, fontVersion, onChange]);

  const family = resolveFontFamily(element, customFonts);

  // Hit-test fill: when no background, use a near-transparent fill so the
  // Rect remains hit-detectable (Konva won't hit-test a Rect with no fill).
  const hitFill = element.backgroundColor || "rgba(0,0,0,0.001)";
  const hitOpacity = element.backgroundColor
    ? element.backgroundOpacity ?? 1
    : 1; // 1 here is fine because the fill alpha itself is ~0

  return (
    <>
      <Group
        ref={groupRef}
        x={element.x}
        y={element.y}
        draggable
        onClick={onSelect}
        onTap={onSelect}
        onMouseDown={onSelect}
        onDblClick={onStartEdit}
        onDblTap={onStartEdit}
        onMouseEnter={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const stage = e.target.getStage();
          if (stage) stage.container().style.cursor = "default";
        }}
        onDragEnd={(e) => {
          onChange({ x: e.target.x(), y: e.target.y() });
        }}
        // Commit on transform END only. Using `onTransform` fires every
        // mousemove tick during a resize, which dispatches a Zustand update
        // (and re-renders the whole canvas + flips `dirty` on every frame).
        // Konva already shows a live preview via the node's scale during the
        // drag; we just need to bake the final size + position back into
        // state when the user releases.
        //
        // Resize semantics (Figma / Canva style):
        //   * Auto mode  — only width handles shown; dragging resizes the box
        //     width and auto-height re-flows the text to fit.
        //   * Fixed mode — all 8 handles shown; resizing changes width and/or
        //     height of the bounding box; fontSize is never scaled.
        onTransformEnd={(e) => {
          const node = e.target as Konva.Group;
          const sx = node.scaleX();
          const sy = node.scaleY();
          const newWidth = Math.max(20, element.width * sx);
          // Auto-height: height is managed by text content — don't bake a
          // scaled value; the useLayoutEffect will re-sync after reflow.
          // Fixed: honour the drag and resize the bounding box.
          const newHeight = isAuto
            ? element.height
            : Math.max(20, element.height * sy);
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            width: newWidth,
            height: newHeight,
            x: node.x(),
            y: node.y(),
          });
        }}
      >
        <Rect
          x={0}
          y={0}
          width={element.width}
          height={element.height}
          fill={hitFill}
          opacity={hitOpacity}
          listening={true}
          perfectDrawEnabled={false}
        />
        <Text
          ref={textRef}
          x={0}
          y={0}
          width={element.width}
          height={isAuto ? undefined : element.height}
          text={element.text}
          fontFamily={family}
          fontStyle={`${element.italic ? "italic " : ""}${element.fontWeight}`}
          textDecoration={
            [
              element.underline ? "underline" : "",
              element.lineThrough ? "line-through" : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
          fontSize={element.fontSize}
          lineHeight={element.lineHeight}
          letterSpacing={element.letterSpacing}
          fill={element.color}
          align={element.align}
          verticalAlign={element.verticalAlign}
          shadowEnabled={!!element.shadow}
          shadowColor={element.shadow?.color}
          shadowBlur={element.shadow?.blur}
          shadowOffsetX={element.shadow?.x}
          shadowOffsetY={element.shadow?.y}
          listening={false}
          visible={!isEditing}
        />
      </Group>
      {isSelected && !isEditing && (
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          enabledAnchors={
            isAuto
              ? ["middle-left", "middle-right"]
              : [
                  "top-left",
                  "top-right",
                  "bottom-left",
                  "bottom-right",
                  "middle-left",
                  "middle-right",
                  "top-center",
                  "bottom-center",
                ]
          }
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 20 || newBox.height < 20) return oldBox;
            return newBox;
          }}
        />
      )}
    </>
  );
}

function InlineEditor({
  element,
  scale,
  customFonts,
  onChange,
  onCommit,
}: {
  element: TextElement;
  scale: number;
  customFonts: CustomFont[];
  onChange: (text: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  const family = resolveFontFamily(element, customFonts);

  return (
    <textarea
      ref={ref}
      value={element.text}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCommit();
        }
      }}
      style={{
        position: "absolute",
        left: element.x * scale,
        top: element.y * scale,
        width: element.width * scale,
        height: element.textSizing === "fixed" ? element.height * scale : undefined,
        minHeight: Math.ceil(element.fontSize * element.lineHeight * scale),
        fontFamily: family,
        fontWeight: element.fontWeight as any,
        fontStyle: element.italic ? "italic" : "normal",
        textDecoration:
          [
            element.underline ? "underline" : "",
            element.lineThrough ? "line-through" : "",
          ]
            .filter(Boolean)
            .join(" ") || "none",
        fontSize: element.fontSize * scale,
        lineHeight: element.lineHeight,
        letterSpacing: `${element.letterSpacing * scale}px`,
        color: element.color,
        textAlign: element.align,
        background:
          element.backgroundColor && element.backgroundOpacity !== 0
            ? element.backgroundColor
            : "transparent",
        opacity: element.backgroundColor
          ? element.backgroundOpacity ?? 1
          : 1,
        border: "1.5px solid rgba(59,130,246,0.7)",
        outline: "none",
        zIndex: 40,
        margin: 0,
        padding: 0,
        resize: "none",
        overflow: element.textSizing === "fixed" ? "hidden" : "visible",
        boxSizing: "border-box",
        // textarea ignores verticalAlign; approximate via padding
        // (vertical centering for textarea is hard without flex on parent)
      }}
    />
  );
}

export function Canvas({ stageRef, fontsLoading }: Props) {
  const template = useEditorStore((s) => s.template);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const updateElement = useEditorStore((s) => s.updateElement);
  const addText = useEditorStore((s) => s.addText);
  const removeElement = useEditorStore((s) => s.removeElement);

  const [editingId, setEditingId] = useState<string | null>(null);

  // Bump on every successful font load so child Text nodes know to recompute
  // their cached glyph metrics. We listen to TWO sources:
  //   1. `document.fonts.loadingdone` — fires when the document's overall
  //      font-loading state goes idle (covers `<link>`-injected Google CSS).
  //   2. Our own `onFontLoaded` — fires when `loadCustomFont` adds an
  //      already-loaded FontFace (which does NOT transition document.fonts'
  //      state and therefore would never fire `loadingdone`). Without this,
  //      picking a custom font shows clipped text in the fallback metrics
  //      until the user switches fonts and back to force a re-render.
  const [fontVersion, setFontVersion] = useState(0);
  useEffect(() => {
    const bump = () => setFontVersion((v) => v + 1);
    const fonts: any = (document as any).fonts;
    fonts?.addEventListener?.("loadingdone", bump);
    const off = onFontLoaded(bump);
    return () => {
      fonts?.removeEventListener?.("loadingdone", bump);
      off();
    };
  }, []);

  // Delete / Backspace removes the selected element when not actively editing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId || editingId) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeElement(selectedId);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, editingId, removeElement]);

  // Same-origin via Vite proxy → no `crossOrigin` needed. Avoids Brave
  // Shields blocking and avoids `<img crossorigin>` cache mismatches with
  // any previously-cached non-CORS response.
  const [bgImage] = useImage(template?.thumbnail_url || "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (!template || size.width === 0 || size.height === 0) return 1;
    return Math.min(
      size.width / template.canvas_width,
      size.height / template.canvas_height
    );
  }, [template, size]);

  // Exit edit mode if the element being edited is removed/deselected externally
  useEffect(() => {
    if (!editingId) return;
    const exists = template?.config_json.elements.some((e) => e.id === editingId);
    if (!exists) setEditingId(null);
  }, [template, editingId]);

  if (!template) return null;

  const cw = template.canvas_width;
  const ch = template.canvas_height;
  const stageW = cw * scale;
  const stageH = ch * scale;
  const bg = bgImage
    ? computeBackgroundCover(bgImage.width, bgImage.height, cw, ch)
    : null;

  const editingElement = editingId
    ? template.config_json.elements.find((e) => e.id === editingId) || null
    : null;

  return (
    <div
      ref={containerRef}
      className="relative flex-1 flex items-center justify-center bg-neutral-950 p-6 overflow-hidden"
    >
      <div
        style={{
          width: stageW,
          height: stageH,
          // Photoshop-style transparency checker. Two-tone dark squares so
          // transparent regions of the template are visibly empty (vs. just
          // looking like a solid dark background). Uses a conic-gradient
          // 2×2 tile sized at 16px → 8px-square checkers.
          backgroundImage:
            "conic-gradient(#1f1f1f 25%, #2a2a2a 0 50%, #1f1f1f 0 75%, #2a2a2a 0)",
          backgroundSize: "16px 16px",
        }}
        className="relative shadow-2xl"
      >
        <Stage
          ref={stageRef}
          width={stageW}
          height={stageH}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={(e) => {
            // Deselect on stage / background click
            const target = e.target;
            if (
              target === e.currentTarget ||
              target.name?.() === "background" ||
              (target as any).attrs?.name === "background"
            ) {
              selectElement(null);
              setEditingId(null);
            }
          }}
        >
          <Layer>
            <Rect
              x={0}
              y={0}
              width={cw}
              height={ch}
              // Near-zero alpha keeps the rect hit-detectable (Konva won't
              // hit-test a Rect with no fill) while letting the wrapper-div
              // checkerboard show through transparent template regions.
              fill="rgba(0,0,0,0.001)"
              name="background"
            />
            {bgImage && bg && (
              <KImage
                image={bgImage}
                x={bg.x}
                y={bg.y}
                width={bg.width}
                height={bg.height}
                // Tagged so the Stage-level onMouseDown handler treats clicks
                // here as deselects. We rely on that single handler instead
                // of duplicating the deselect on this node's onMouseDown.
                name="background"
                listening={true}
              />
            )}
            {template.config_json.elements.map((el) => (
              <TextNode
                key={el.id}
                element={el}
                isSelected={selectedId === el.id}
                isEditing={editingId === el.id}
                customFonts={template.custom_fonts}
                fontVersion={fontVersion}
                onSelect={() => selectElement(el.id)}
                onStartEdit={() => {
                  selectElement(el.id);
                  setEditingId(el.id);
                }}
                onChange={(patch) => updateElement(el.id, patch)}
              />
            ))}
          </Layer>
        </Stage>

        {editingElement && (
          <InlineEditor
            element={editingElement}
            scale={scale}
            customFonts={template.custom_fonts}
            onChange={(text) => updateElement(editingElement.id, { text })}
            onCommit={() => setEditingId(null)}
          />
        )}

        {/*
          Font-load overlay. Painted while the editor is preloading custom
          and Google fonts so users don't see text flash in a system fallback
          before the real font swaps in. Sits above the Stage but below the
          inline editor (which only mounts when the user is actively typing).
        */}
        {fontsLoading && (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-neutral-950/70 backdrop-blur-sm"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={28} className="animate-spin text-neutral-200" />
            <span className="text-sm text-neutral-300">Loading fonts…</span>
          </div>
        )}
      </div>

      {template.config_json.elements.length === 0 && (
        <button
          onClick={addText}
          className="absolute rounded-lg bg-blue-600/90 hover:bg-blue-500 px-6 py-3 text-sm font-medium shadow-lg pointer-events-auto"
        >
          + Add Text
        </button>
      )}
    </div>
  );
}
