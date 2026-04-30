import { useEffect, useMemo, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  ChevronDown,
  ChevronUp,
  Italic,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { useEditorStore } from "../stores/editorStore";
import { FontPicker } from "./FontPicker";
import {
  availableWeightsForCustomFamily,
  STANDARD_FONT_WEIGHTS,
  loadGoogleFont,
} from "../lib/fonts";
import type { TextElement } from "../types";

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-neutral-400 uppercase">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isNaN(v)) onChange(v);
        }}
        className="mt-0.5 w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="block">
      <span className="text-[11px] text-neutral-400 uppercase">{label}</span>
      <div className="mt-0.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-7 w-7 shrink-0 rounded border border-neutral-600"
          style={{ backgroundColor: value }}
          title={open ? "Close color picker" : "Open color picker"}
          aria-label={open ? "Close color picker" : "Open color picker"}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs font-mono focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
          aria-label={open ? "Close color picker" : "Open color picker"}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {open && (
        <div className="mt-2">
          <HexColorPicker
            color={value}
            onChange={onChange}
            style={{ width: "100%" }}
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: any;
}) {
  return (
    <div className="border-b border-neutral-800 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ElementList({
  elements,
  selectedId,
  onSelect,
  onRemove,
}: {
  elements: TextElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (elements.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-neutral-500">
        No text elements yet. Click "+ Add Text" to create one.
      </div>
    );
  }
  return (
    <div className="border-b border-neutral-800">
      <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Text Elements ({elements.length})
      </div>
      <ul className="px-2 pb-2">
        {elements.map((el, i) => (
          <li
            key={el.id}
            onClick={() => onSelect(el.id)}
            className={`group flex items-center justify-between gap-2 rounded px-2 py-1.5 cursor-pointer text-sm ${
              selectedId === el.id
                ? "bg-blue-900/40 text-blue-100"
                : "hover:bg-neutral-800 text-neutral-300"
            }`}
          >
            <span className="truncate flex-1">
              <span className="text-neutral-500 mr-2">#{i + 1}</span>
              {el.text || <em className="text-neutral-500">(empty)</em>}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(el.id);
              }}
              className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-400"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PropertiesPanel() {
  const template = useEditorStore((s) => s.template);
  const selectedId = useEditorStore((s) => s.selectedId);
  const updateElement = useEditorStore((s) => s.updateElement);
  const removeElement = useEditorStore((s) => s.removeElement);
  const selectElement = useEditorStore((s) => s.selectElement);
  const addText = useEditorStore((s) => s.addText);

  const el = useMemo(
    () =>
      template?.config_json.elements.find((e) => e.id === selectedId) ?? null,
    [template, selectedId]
  );

  if (!template) return null;

  if (!el) {
    return (
      <div className="w-72 shrink-0 border-l border-neutral-800 bg-neutral-900 overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 sticky top-0 bg-neutral-900 z-10">
          <div className="text-sm font-medium">Text Elements</div>
          <button
            onClick={addText}
            className="rounded px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500"
          >
            + Add
          </button>
        </div>
        <ElementList
          elements={template.config_json.elements}
          selectedId={selectedId}
          onSelect={selectElement}
          onRemove={removeElement}
        />
        <div className="px-4 py-3 text-xs text-neutral-500">
          Click a text element above to edit its properties.
        </div>
      </div>
    );
  }

  const isCustomFamily = template.custom_fonts.some(
    (f) => f.family === el.fontFamily
  );
  const weightOptions = isCustomFamily
    ? availableWeightsForCustomFamily(el.fontFamily, template.custom_fonts)
    : STANDARD_FONT_WEIGHTS;

  function update(patch: Partial<TextElement>) {
    if (!el) return;
    updateElement(el.id, patch);
  }

  function setBackgroundColor(c: string) {
    if (!el) return;
    // When picking a bg color the first time, default opacity to 1 so the
    // background actually shows (instead of relying on the canvas' `?? 1`
    // fallback which mismatched the panel's display default of 0).
    const opacity = el.backgroundOpacity ?? 1;
    updateElement(el.id, { backgroundColor: c, backgroundOpacity: opacity });
  }

  const cw = template.canvas_width;
  const ch = template.canvas_height;

  function centerHorizontal() {
    if (!el) return;
    update({ x: Math.round((cw - el.width) / 2) });
  }
  function centerVertical() {
    if (!el) return;
    update({ y: Math.round((ch - el.height) / 2) });
  }

  const shadow = el.shadow ?? { color: "#000000", x: 0, y: 0, blur: 0 };

  return (
    <div className="w-72 shrink-0 border-l border-neutral-800 bg-neutral-900 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 sticky top-0 bg-neutral-900 z-10">
        <div className="text-sm font-medium">Text Properties</div>
        <div className="flex items-center gap-1">
          <button
            onClick={addText}
            className="rounded px-2 py-1 text-xs hover:bg-neutral-800"
            title="Add text"
          >
            + Add
          </button>
          <button
            onClick={() => removeElement(el.id)}
            className="rounded p-1.5 text-red-400 hover:bg-red-900/30"
            title="Delete element"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => selectElement(null)}
            className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <ElementList
        elements={template.config_json.elements}
        selectedId={selectedId}
        onSelect={selectElement}
        onRemove={removeElement}
      />

      <Section title="Content">
        <textarea
          value={el.text}
          onChange={(e) => update({ text: e.target.value })}
          rows={2}
          className="w-full rounded bg-neutral-800 border border-neutral-700 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none resize-y"
        />
      </Section>

      <Section title="Typography">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <span className="text-[11px] text-neutral-400 uppercase">Font Family</span>
            <FontPicker
              value={el.fontFamily}
              onChange={(family) => update({ fontFamily: family })}
            />
          </div>
          <div>
            <span className="text-[11px] text-neutral-400 uppercase">Font Weight</span>
            <select
              value={el.fontWeight}
              onChange={(e) => {
                const w = e.target.value;
                update({ fontWeight: w });
                if (!isCustomFamily) loadGoogleFont(el.fontFamily, parseInt(w, 10));
              }}
              className="w-full mt-0.5 rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-sm"
            >
              {weightOptions.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </div>
          <NumberField label="Font Size" value={el.fontSize} onChange={(v) => update({ fontSize: v })} min={1} />
          <NumberField label="Line Height" value={el.lineHeight} step={0.05} onChange={(v) => update({ lineHeight: v })} min={0.1} />
          <NumberField label="Letter Spacing" value={el.letterSpacing} step={0.5} onChange={(v) => update({ letterSpacing: v })} />
        </div>
      </Section>

      <Section title="Text Style">
        <div className="grid grid-cols-3 gap-1">
          <ToggleIconButton
            active={!!el.italic}
            onClick={() => update({ italic: !el.italic })}
            label="Italic"
          >
            <Italic size={14} />
          </ToggleIconButton>
          <ToggleIconButton
            active={!!el.underline}
            onClick={() => update({ underline: !el.underline })}
            label="Underline"
          >
            <Underline size={14} />
          </ToggleIconButton>
          <ToggleIconButton
            active={!!el.lineThrough}
            onClick={() => update({ lineThrough: !el.lineThrough })}
            label="Strikethrough"
          >
            <Strikethrough size={14} />
          </ToggleIconButton>
        </div>
      </Section>

      <Section title="Alignment">
        <div>
          <span className="text-[11px] text-neutral-400 uppercase">Text Align</span>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {([
              ["left", AlignLeft],
              ["center", AlignCenter],
              ["right", AlignRight],
            ] as const).map(([a, Icon]) => (
              <ToggleIconButton
                key={a}
                active={el.align === a}
                onClick={() => update({ align: a })}
                label={`Align ${a}`}
              >
                <Icon size={14} />
              </ToggleIconButton>
            ))}
          </div>
        </div>
        <div>
          <span className="text-[11px] text-neutral-400 uppercase">Vertical Align (text)</span>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {(["top", "middle", "bottom"] as const).map((a) => (
              <ToggleIconButton
                key={a}
                active={el.verticalAlign === a}
                onClick={() => update({ verticalAlign: a })}
                label={`Vertical ${a}`}
              >
                <span className="text-[10px] uppercase">{a}</span>
              </ToggleIconButton>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <ActionIconButton onClick={centerVertical} label="Center on canvas vertically">
            <AlignVerticalJustifyCenter size={14} />
            <span>Center V</span>
          </ActionIconButton>
          <ActionIconButton onClick={centerHorizontal} label="Center on canvas horizontally">
            <AlignHorizontalJustifyCenter size={14} />
            <span>Center H</span>
          </ActionIconButton>
        </div>
      </Section>

      <Section title="Styling">
        <ColorField label="Text Color" value={el.color} onChange={(c) => update({ color: c })} />
        <ColorField
          label="Background Color"
          value={el.backgroundColor || "#000000"}
          onChange={setBackgroundColor}
        />
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-neutral-400 uppercase">
              Background Opacity
            </span>
            <span className="text-xs text-neutral-300 tabular-nums">
              {Math.round((el.backgroundOpacity ?? 1) * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={el.backgroundOpacity ?? 1}
            onChange={(e) =>
              update({ backgroundOpacity: parseFloat(e.target.value) })
            }
            disabled={!el.backgroundColor}
            className="mt-1 w-full accent-blue-500 disabled:opacity-50"
          />
        </div>
        {el.backgroundColor && (
          <button
            onClick={() => update({ backgroundColor: undefined, backgroundOpacity: undefined })}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            Clear background
          </button>
        )}
      </Section>

      <Section title="Position & Size">
        <div className="flex items-center gap-1 mb-2">
          <span className="text-[11px] text-neutral-400 uppercase mr-auto">Text Sizing</span>
          <ToggleIconButton
            active={el.textSizing !== "fixed"}
            onClick={() => update({ textSizing: "auto" })}
            label="Auto height — grows with content"
          >
            <span className="text-[10px] font-medium">Auto</span>
          </ToggleIconButton>
          <ToggleIconButton
            active={el.textSizing === "fixed"}
            onClick={() => update({ textSizing: "fixed" })}
            label="Fixed size — clips overflow"
          >
            <span className="text-[10px] font-medium">Fixed</span>
          </ToggleIconButton>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Width" value={el.width} onChange={(v) => update({ width: Math.max(20, v) })} />
          <NumberField
            label={el.textSizing !== "fixed" ? "Height (auto)" : "Height"}
            value={el.height}
            onChange={(v) => update({ height: Math.max(20, v), textSizing: "fixed" })}
          />
          <NumberField label="X" value={el.x} onChange={(v) => update({ x: v })} />
          <NumberField label="Y" value={el.y} onChange={(v) => update({ y: v })} />
        </div>
      </Section>

      <Section title="Shadow">
        <ColorField
          label="Shadow Color"
          value={shadow.color}
          onChange={(c) => update({ shadow: { ...shadow, color: c } })}
        />
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="X"
            value={shadow.x}
            onChange={(v) => update({ shadow: { ...shadow, x: v } })}
          />
          <NumberField
            label="Y"
            value={shadow.y}
            onChange={(v) => update({ shadow: { ...shadow, y: v } })}
          />
          <NumberField
            label="Blur"
            value={shadow.blur}
            min={0}
            onChange={(v) => update({ shadow: { ...shadow, blur: Math.max(0, v) } })}
          />
        </div>
        {el.shadow && (
          <button
            onClick={() => update({ shadow: undefined })}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            Clear shadow
          </button>
        )}
      </Section>
    </div>
  );
}

function ToggleIconButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: any;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center justify-center rounded px-2 py-1.5 text-xs ${
        active
          ? "bg-blue-600 text-white"
          : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}

function ActionIconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: any;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
    >
      {children}
    </button>
  );
}
