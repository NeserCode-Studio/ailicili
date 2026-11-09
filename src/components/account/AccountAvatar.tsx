import { UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createLogger } from "@/lib/logger";

const log = createLogger("Account/Avatar");

interface AccountAvatarProps {
  src?: string;
  className?: string;
  fallback?: ReactNode;
}

function imageLogFields(src: string) {
  try {
    const url = new URL(src);
    return {
      host: url.host,
      path: url.pathname,
      query: url.search.length > 0,
    };
  } catch {
    return { validUrl: false, srcLength: src.length };
  }
}

export default function AccountAvatar({
  src,
  className,
  fallback,
}: AccountAvatarProps) {
  return (
    <Avatar className={className}>
      {src ? (
        <AvatarImage
          src={src}
          alt=""
          className="object-cover"
          referrerPolicy="no-referrer"
          loading="eager"
          onLoad={() => log.debug("avatar loaded", imageLogFields(src))}
          onError={() => log.warn("avatar failed", imageLogFields(src))}
        />
      ) : null}
      <AvatarFallback delayMs={src ? 200 : 0}>
        {fallback ?? <UserRound className="icon-sm" />}
      </AvatarFallback>
    </Avatar>
  );
}
