import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../ui/button";

interface GalleryPaginationProps {
  page: number;
  total: number;
  pageSize: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
}

export function GalleryPagination({ page, total, pageSize, hasMore, onPageChange }: GalleryPaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 pt-6">
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        iconLeft={<ChevronLeft className="h-4 w-4" />}
      >
        Previous
      </Button>
      <span className="text-sm text-[hsl(var(--muted-foreground))]">
        Page {page} of {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasMore}
        onClick={() => onPageChange(page + 1)}
        iconRight={<ChevronRight className="h-4 w-4" />}
      >
        Next
      </Button>
    </div>
  );
}
