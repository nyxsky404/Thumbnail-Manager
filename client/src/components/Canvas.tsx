import { useEffect, useMemo, useRef, useState } from "react";
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
import { useEditorStore } from "../stores/editorStore";
import { customFontFamilyName } from "../lib/fonts";
import type { TextElement, CustomFont } from "../types";

interface Props {
  stageRef?: React.RefObject<Konva.Stage>;
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
        // Handle semantics (matches Figma / Canva conventions):
        //   * Corner drag (both axes scaled, kept in ratio by Konva's
        //     Transformer) → scale fontSize too so the text grows with the
        //     box. This is what users expect when resizing a headline.
        //   * Side drag (only one axis changes) → leave fontSize alone and
        //     just reshape the box; the text reflows inside.
        onTransformEnd={(e) => {
          const node = e.target as Konva.Group;
          const sx = node.scaleX();
          const sy = node.scaleY();

          const EPS = 0.001;
          const sxChanged = Math.abs(sx - 1) > EPS;
          const syChanged = Math.abs(sy - 1) > EPS;
          const isCornerDrag = sxChanged && syChanged;

          const newWidth = Math.max(20, element.width * sx);
          const newHeight = Math.max(20, element.height * sy);

          // For corner drags, Transformer.keepRatio (default true on corners)
          // makes sx === sy so the average is just that scale; using the
          // average also degrades gracefully if a future change opts out of
          // keepRatio. Clamp the resulting fontSize to a sensible range.
          let newFontSize = element.fontSize;
          if (isCornerDrag) {
            const fontScale = (sx + sy) / 2;
            newFontSize = Math.max(8, Math.min(512, Math.round(element.fontSize * fontScale)));
          }

          node.scaleX(1);
          node.scaleY(1);
          onChange({
            width: newWidth,
            height: newHeight,
            ...(isCornerDrag ? { fontSize: newFontSize } : null),
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
          height={element.height}
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
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
            "middle-left",
            "middle-right",
            "top-center",
            "bottom-center",
          ]}
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
        height: element.height * scale,
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
            : "rgba(0,0,0,0.15)",
        opacity: element.backgroundColor
          ? element.backgroundOpacity ?? 1
          : 1,
        border: "2px dashed #3b82f6",
        outline: "none",
        margin: 0,
        padding: 0,
        resize: "none",
        overflow: "hidden",
        boxSizing: "border-box",
        display: "flex",
        // textarea ignores verticalAlign; approximate via padding
        // (vertical centering for textarea is hard without flex on parent)
      }}
    />
  );
}

export function Canvas({ stageRef }: Props) {
  const template = useEditorStore((s) => s.template);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectElement = useEditorStore((s) => s.selectElement);
  const updateElement = useEditorStore((s) => s.updateElement);
  const addText = useEditorStore((s) => s.addText);

  const [editingId, setEditingId] = useState<string | null>(null);

  // Bump on every `document.fonts.loadingdone` so child Text nodes know to
  // recompute their cached glyph metrics. Without this, the canvas keeps
  // rendering with the fallback font that was in place at first paint.
  const [fontVersion, setFontVersion] = useState(0);
  useEffect(() => {
    const fonts: any = (document as any).fonts;
    if (!fonts || typeof fonts.addEventListener !== "function") return;
    const onLoadingDone = () => setFontVersion((v) => v + 1);
    fonts.addEventListener("loadingdone", onLoadingDone);
    return () => fonts.removeEventListener("loadingdone", onLoadingDone);
  }, []);

  // Same-origin via Vite proxy → no `crossOrigin` needed. Avoids Brave
  // Shields blocking and avoids `<img crossorigin>` cache mismatches with
  // any previously-cached non-CORS response.
  const [bgImage] = useImage(template?.thumbnail_url || "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      setSize({ width: r.width, height: r.height });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
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
        style={{ width: stageW, height: stageH }}
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
              fill="#1a1a1a"
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
