import { APP_VERSION } from "../version";

export function VersionFooter() {
  return (
    <span
      className="fixed bottom-1 right-2 z-50 select-none text-[10px] leading-none text-[hsl(var(--foreground))] opacity-50"
      aria-hidden="true"
    >
      v{APP_VERSION}
    </span>
  );
}
