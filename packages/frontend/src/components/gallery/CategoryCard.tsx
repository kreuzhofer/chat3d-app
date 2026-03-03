import { Link } from "react-router-dom";
import { Box } from "lucide-react";
import { Badge } from "../ui/badge";
import { getGalleryScreenshotUrl, type GalleryCategory } from "../../api/gallery.api";

interface CategoryCardProps {
  category: GalleryCategory;
}

export function CategoryCard({ category }: CategoryCardProps) {
  const heroScreenshotUrl = category.heroModel
    ? getGalleryScreenshotUrl(category.heroModel.id)
    : null;

  return (
    <Link
      to={`/gallery/category/${encodeURIComponent(category.id)}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition hover:border-[hsl(var(--primary)_/_0.4)] hover:shadow-md"
    >
      <div className="relative aspect-square bg-[hsl(var(--muted))] overflow-hidden">
        {heroScreenshotUrl ? (
          <img
            src={heroScreenshotUrl}
            alt={category.heroModel?.promptText ?? category.name}
            className="h-full w-full object-contain transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]">
            <Box className="h-12 w-12 opacity-40" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
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
