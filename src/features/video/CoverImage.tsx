import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

interface CoverImageProps {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}

export default function CoverImage({
  src,
  alt,
  className,
  eager = false,
}: CoverImageProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={cn(
        "bg-muted relative overflow-hidden after:pointer-events-none after:absolute after:inset-0 after:border after:border-black/5 after:content-[''] dark:after:border-white/5",
        className
      )}
    >
      {!failed && src ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover transition-transform duration-300 ease-out"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="text-muted-foreground flex size-full items-center justify-center">
          <ImageOff className="size-6" />
        </div>
      )}
    </div>
  );
}
