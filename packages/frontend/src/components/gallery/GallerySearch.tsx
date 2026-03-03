import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "../ui/input";

interface GallerySearchProps {
  initialQuery?: string;
  onSearch: (query: string) => void;
}

export function GallerySearch({ initialQuery = "", onSearch }: GallerySearchProps) {
  const [value, setValue] = useState(initialQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      onSearch(trimmed);
    },
    [onSearch],
  );

  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (value.trim().length === 0) {
      submit("");
      return;
    }
    debounceRef.current = setTimeout(() => submit(value), 400);
    return () => clearTimeout(debounceRef.current);
  }, [value, submit]);

  return (
    <div className="relative w-full max-w-lg">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
      <Input
        className="pl-9 pr-9"
        placeholder="Search models (e.g. phone stand, gear, vase)..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            clearTimeout(debounceRef.current);
            submit(value);
          }
        }}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          onClick={() => setValue("")}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
