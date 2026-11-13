/**
 * Controls with floating descendants must render this on an absolute sibling.
 * Using it on the ancestor creates a backdrop root and blocks video sampling.
 */
export const PLAYER_CONTROL_SURFACE_CLASS =
  "border-border bg-background/50 text-foreground backdrop-blur-[24px] backdrop-saturate-150";
