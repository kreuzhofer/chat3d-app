import { cn } from "../../lib/cn";

type AvatarSize = "sm" | "md" | "lg";

const sizeClasses: Record<AvatarSize, string> = {
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
};

/** Deterministic color palette derived from a string (e.g. email or name) */
const avatarColors = [
  "bg-[hsl(203_90%_42%)] text-white",    // primary blue
  "bg-[hsl(262_60%_55%)] text-white",    // accent purple
  "bg-[hsl(152_60%_38%)] text-white",    // success green
  "bg-[hsl(38_92%_50%)] text-white",     // warning amber
  "bg-[hsl(340_65%_50%)] text-white",    // rose
  "bg-[hsl(180_55%_40%)] text-white",    // teal
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface AvatarProps {
  /** Display name or email — used to derive initials and color */
  name: string;
  /** Image URL (optional — falls back to initials) */
  src?: string;
  size?: AvatarSize;
  className?: string;
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const colorIndex = hashString(name) % avatarColors.length;
  const initials = getInitials(name);

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full object-cover",
          sizeClasses[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none",
        sizeClasses[size],
        avatarColors[colorIndex],
        className,
      )}
    >
      {initials}
    </span>
  );
}
