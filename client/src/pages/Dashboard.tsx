import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Star, Trash2, Edit, ImageOff } from "lucide-react";
import { useTemplatesStore } from "../stores/templatesStore";
import { UploadModal } from "../components/UploadModal";

export function Dashboard() {
  const navigate = useNavigate();
  const { templates, loading, error, load, remove, setDefault } = useTemplatesStore();
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Thumbnail Templates</h1>
          <p className="text-sm text-neutral-400">
            Upload background images and configure text overlays.
          </p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium"
        >
          <Plus size={16} /> New Template
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded bg-red-900/40 border border-red-800 px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {loading && templates.length === 0 ? (
        <div className="text-neutral-400">Loading...</div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-700 p-12 text-center">
          <ImageOff size={32} className="mx-auto mb-3 text-neutral-500" />
          <h3 className="font-semibold mb-1">No templates yet</h3>
          <p className="text-sm text-neutral-400 mb-4">
            Create your first template to start designing thumbnails.
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-medium"
          >
            Upload PNG
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div
              key={t.id}
              className="group relative rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-neutral-700 transition"
            >
              <div className="relative aspect-video bg-neutral-800">
                <img
                  src={t.thumbnail_url}
                  alt={t.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {t.is_default && (
                  <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-yellow-500/90 text-black text-xs font-medium px-2 py-0.5">
                    <Star size={12} /> Default
                  </span>
                )}
                <span className="absolute top-2 right-2 rounded bg-black/60 text-xs px-2 py-0.5">
                  {t.preset}
                </span>
              </div>
              <div className="p-3">
                <div className="font-medium truncate mb-1">{t.name}</div>
                <div className="text-xs text-neutral-500 mb-3">
                  {t.canvas_width}×{t.canvas_height} ·{" "}
                  {t.config_json?.elements?.length || 0} text elements
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate(`/editor/${t.id}`)}
                    className="flex items-center gap-1 rounded bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-xs"
                  >
                    <Edit size={12} /> Edit
                  </button>
                  {!t.is_default && (
                    <button
                      onClick={() => setDefault(t.id)}
                      className="flex items-center gap-1 rounded bg-neutral-800 hover:bg-neutral-700 px-3 py-1.5 text-xs"
                    >
                      <Star size={12} /> Set Default
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`Delete template "${t.name}"?`)) remove(t.id);
                    }}
                    className="ml-auto flex items-center gap-1 rounded bg-neutral-800 hover:bg-red-900 px-3 py-1.5 text-xs"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <UploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onCreated={(id) => navigate(`/editor/${id}`)}
      />
    </div>
  );
}
