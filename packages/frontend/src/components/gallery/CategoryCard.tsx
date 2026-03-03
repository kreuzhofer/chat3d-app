import { Link } from "react-router-dom";
import { Box } from "lucide-react";
import { Badge } from "../ui/badge";
import { getGalleryScreenshotUrl, type GalleryCategory } from "../../api/gallery.api";

interface CategoryCardProps {
  category: GalleryCategory;
}

export function CategoryCard({ category }: CategoryCardProps) {
  const previews = category.previewModels;

  return (
    <Link
      to={`/gallery/category/${encodeURIComponent(category.id)}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition hover:border-[hsl(var(--primary)_/_0.4)] hover:shadow-md"
    >
      <div className="relative aspect-square bg-[hsl(var(--muted))] overflow-hidden">
        {previews.length > 0 ? (
          <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-0.5 p-0.5">
            {Array.from({ length: 4 }, (_, i) => {
              const model = previews[i];
              if (model) {
                return (
                  <div key={model.id} className="overflow-hidden bg-[hsl(var(--muted))]">
                    <img
                      src={getGalleryScreenshotUrl(model.id)}
                      alt={model.promptText}
                      className="h-full w-full object-contain transition group-hover:scale-105"
                      loading="lazy"
                    />
                  </div>
                );
              }
              return (
                <div key={`empty-${i}`} className="flex items-center justify-center bg-[hsl(var(--muted))]">
                  <Box className="h-6 w-6 opacity-20" />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]">
            <Box className="h-12 w-12 opacity-40" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] line-clamp-1">
          {category.name}
        </h3>
        <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-2">
          {category.description}
        </p>
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Badge tone="neutral">{category.modelCount} models</Badge>
          <Badge tone="info">Level {category.complexity}</Badge>
        </div>
      </div>
    </Link>
  );
}
