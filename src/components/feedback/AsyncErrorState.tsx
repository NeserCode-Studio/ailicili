import { AlertCircle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AsyncErrorStateProps {
  title: string;
  description: string;
  code?: string;
  onRetry?: () => void;
  retryLabel: string;
}

export default function AsyncErrorState({
  title,
  description,
  code,
  onRetry,
  retryLabel,
}: AsyncErrorStateProps) {
  return (
    <div
      role="alert"
      className="border-border flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center"
    >
      <span className="bg-destructive/10 text-destructive flex size-10 items-center justify-center rounded-full">
        <AlertCircle className="size-5" />
      </span>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
        {code && (
          <p className="text-muted-foreground/70 font-mono text-[11px]">
            {code}
          </p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCcw className="size-3.5" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
