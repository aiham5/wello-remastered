import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";

interface ImageLightboxProps {
  open: boolean;
  imageUrl: string;
  title?: string;
  onClose: () => void;
}

export function ImageLightbox({
  open,
  imageUrl,
  title = "Receipt Image",
  onClose,
}: ImageLightboxProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl max-h-[95vh] bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Open original
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5 text-gray-700" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-50 p-3 overflow-auto">
          <img src={imageUrl} alt={title} className="w-full h-full object-contain rounded" />
        </div>
      </div>
    </div>
  );
}
