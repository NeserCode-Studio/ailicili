import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  LoaderCircle,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/composables";
import { cn } from "@/lib/utils";

export interface ImagePreviewItem {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

interface ImagePreviewDialogProps {
  images: ImagePreviewItem[];
  activeIndex: number | null;
  onIndexChange: (index: number | null) => void;
}

function PreviewImage({ image }: { image: ImagePreviewItem }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={image.alt}
        className="text-muted-foreground flex size-full flex-col items-center justify-center gap-3"
      >
        <ImageOff className="size-9" />
        <span className="text-sm">{t("ImagePreview.loadError")}</span>
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <LoaderCircle
          aria-hidden="true"
          className="text-muted-foreground absolute size-7 animate-spin"
        />
      )}
      <img
        src={image.url}
        alt={image.alt}
        width={image.width || undefined}
        height={image.height || undefined}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "max-h-full max-w-full object-contain transition-opacity duration-200 select-none",
          loaded ? "opacity-100" : "opacity-0"
        )}
      />
    </>
  );
}

export default function ImagePreviewDialog({
  images,
  activeIndex,
  onIndexChange,
}: ImagePreviewDialogProps) {
  const { t } = useI18n();
  const open = activeIndex !== null && images.length > 0;
  const currentIndex =
    activeIndex === null
      ? 0
      : Math.min(Math.max(activeIndex, 0), Math.max(images.length - 1, 0));
  const currentImage = images[currentIndex];
  const hasMultiple = images.length > 1;

  useEffect(() => {
    if (!open || !hasMultiple) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange((currentIndex - 1 + images.length) % images.length);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndexChange((currentIndex + 1) % images.length);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, hasMultiple, images.length, onIndexChange, open]);

  if (!currentImage) return null;

  const showPrevious = () => {
    onIndexChange((currentIndex - 1 + images.length) % images.length);
  };
  const showNext = () => {
    onIndexChange((currentIndex + 1) % images.length);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onIndexChange(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100dvh-2rem)] max-h-[60rem] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden border-white/15 bg-[#0b0b0c] p-0 text-white shadow-2xl sm:max-w-[90rem]"
      >
        <header className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold">
              {t("ImagePreview.title")}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-xs text-white/60 tabular-nums">
              {t("ImagePreview.counter", {
                current: currentIndex + 1,
                total: images.length,
              })}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("ImagePreview.close")}
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              <X className="size-4" />
            </button>
          </DialogClose>
        </header>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-3 sm:p-6">
          <PreviewImage key={currentImage.url} image={currentImage} />

          {hasMultiple && (
            <>
              <button
                type="button"
                aria-label={t("ImagePreview.previous")}
                onClick={showPrevious}
                className="absolute top-1/2 left-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none sm:left-5"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                aria-label={t("ImagePreview.next")}
                onClick={showNext}
                className="absolute top-1/2 right-3 flex size-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none sm:right-5"
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          )}
        </div>

        {hasMultiple && (
          <div className="border-t border-white/10 bg-[#101012] px-3 py-2">
            <div className="flex items-center justify-center gap-2 overflow-x-auto">
              {images.map((image, index) => (
                <button
                  key={image.url}
                  type="button"
                  aria-label={t("ImagePreview.select", { current: index + 1 })}
                  aria-pressed={index === currentIndex}
                  onClick={() => onIndexChange(index)}
                  className={cn(
                    "relative h-14 w-20 shrink-0 overflow-hidden rounded-md border transition-opacity focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none",
                    index === currentIndex
                      ? "border-white opacity-100"
                      : "border-transparent opacity-55 hover:opacity-90"
                  )}
                >
                  <img
                    src={image.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
