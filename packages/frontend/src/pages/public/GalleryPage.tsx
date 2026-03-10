import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Layers, Search as SearchIcon } from "lucide-react";
import {
  getGalleryCategories,
  getGalleryCategoryModels,
  getModelPosition,
  searchGalleryModels,
  type GalleryCategory,
  type GalleryModelSummary,
  type GallerySearchResult,
  type PaginatedResult,
} from "../../api/gallery.api";
import { CategoryCard } from "../../components/gallery/CategoryCard";
import { ModelCard } from "../../components/gallery/ModelCard";
import { GalleryPagination } from "../../components/gallery/GalleryPagination";
import { GallerySearch } from "../../components/gallery/GallerySearch";
import { Skeleton } from "../../components/ui/skeleton";
import { RevealOnView } from "../../components/ui/RevealOnView";

const PAGE_SIZE = 20;

type GalleryView = "categories" | "category-detail" | "search";

export function GalleryPage() {
  const { categoryId } = useParams<{ categoryId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const queryParam = searchParams.get("q") ?? "";
  const highlightParam = searchParams.get("highlight") ?? "";

  // Determine active view
  const view: GalleryView = queryParam.length >= 3
    ? "search"
    : categoryId
      ? "category-detail"
      : "categories";

  // ── Categories state ──────────────────────────────────────────────
  const [categoriesResult, setCategoriesResult] = useState<PaginatedResult<GalleryCategory> | null>(null);
  const [categoriesPage, setCategoriesPage] = useState(1);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // ── Category detail state ─────────────────────────────────────────
  const [modelsResult, setModelsResult] = useState<PaginatedResult<GalleryModelSummary> | null>(null);
  const [modelsPage, setModelsPage] = useState(1);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [categoryName, setCategoryName] = useState<string>("");

  // ── Search state ──────────────────────────────────────────────────
  const [searchResult, setSearchResult] = useState<PaginatedResult<GallerySearchResult> | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchLoading, setSearchLoading] = useState(false);

  // ── Highlight / deep-link state ───────────────────────────────────
  const [highlightId, setHighlightId] = useState<string>("");
  const highlightResolved = useRef(false);

  // Resolve highlight param: fetch model position and set the correct page
  useEffect(() => {
    if (!highlightParam || !categoryId || view !== "category-detail") return;
    if (highlightResolved.current) return;
    highlightResolved.current = true;

    getModelPosition(highlightParam, PAGE_SIZE)
      .then((pos) => {
        setModelsPage(pos.page);
        setHighlightId(highlightParam);
      })
      .catch(() => {
        // Position lookup failed — just load page 1
        setHighlightId("");
      });
  }, [highlightParam, categoryId, view]);

  // Reset highlight resolved flag when navigating away
  useEffect(() => {
    if (!highlightParam) {
      highlightResolved.current = false;
      setHighlightId("");
    }
  }, [highlightParam]);

  // Scroll to highlighted model after data loads
  useEffect(() => {
    if (!highlightId || modelsLoading || !modelsResult) return;
    // Use requestAnimationFrame to wait for DOM paint
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`model-${highlightId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Add a brief highlight ring
        el.classList.add("ring-2", "ring-[hsl(var(--primary))]", "ring-offset-2");
        const timer = setTimeout(() => {
          el.classList.remove("ring-2", "ring-[hsl(var(--primary))]", "ring-offset-2");
          // Clear the highlight param from URL after scrolling
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete("highlight");
            return next;
          });
          setHighlightId("");
        }, 2000);
        return () => clearTimeout(timer);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightId, modelsLoading, modelsResult, setSearchParams]);

  // ── Load categories ───────────────────────────────────────────────
  useEffect(() => {
    if (view !== "categories") return;
    let cancelled = false;
    setCategoriesLoading(true);
    getGalleryCategories(categoriesPage, PAGE_SIZE).then((result) => {
      if (!cancelled) {
        setCategoriesResult(result);
        setCategoriesLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [view, categoriesPage]);

  // ── Load models for category ──────────────────────────────────────
  useEffect(() => {
    if (view !== "category-detail" || !categoryId) return;
    let cancelled = false;
    setModelsLoading(true);
    getGalleryCategoryModels(categoryId, modelsPage, PAGE_SIZE).then((result) => {
      if (!cancelled) {
        setModelsResult(result);
        setModelsLoading(false);
        // Derive category name from first result
        if (result.items.length > 0) {
          setCategoryName(result.items[0].categoryName);
        }
      }
    });
    return () => { cancelled = true; };
  }, [view, categoryId, modelsPage]);

  // ── Search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (view !== "search") return;
    let cancelled = false;
    setSearchLoading(true);
    searchGalleryModels(queryParam, searchPage, PAGE_SIZE).then((result) => {
      if (!cancelled) {
        setSearchResult(result);
        setSearchLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [view, queryParam, searchPage]);

  const handleSearch = useCallback(
    (query: string) => {
      if (query.length >= 3) {
        setSearchParams({ q: query });
        setSearchPage(1);
      } else if (query.length === 0) {
        setSearchParams({});
        setSearchResult(null);
      }
    },
    [setSearchParams],
  );

  // ── Render helpers ────────────────────────────────────────────────

  function renderSkeletonGrid(count: number) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            <Skeleton className="aspect-square w-full" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Layers className="h-6 w-6 text-[hsl(var(--primary))]" />
          <h1 className="text-2xl font-semibold text-[hsl(var(--foreground))]">
            Model Gallery
          </h1>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Browse and download community 3D models, or remix them into your own designs.
        </p>
      </div>

      {/* Search */}
      <GallerySearch initialQuery={queryParam} onSearch={handleSearch} />

      {/* ── Search Results View ─────────────────────────────────────── */}
      {view === "search" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <SearchIcon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <h2 className="text-lg font-medium text-[hsl(var(--foreground))]">
              Search results for &ldquo;{queryParam}&rdquo;
            </h2>
            {searchResult && (
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                ({searchResult.total} found)
              </span>
            )}
          </div>

          {searchLoading ? (
            renderSkeletonGrid(8)
          ) : searchResult && searchResult.items.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {searchResult.items.map((model, i) => (
                  <RevealOnView key={model.id} delay={(i % 4) * 50}>
                    <ModelCard model={model} />
                  </RevealOnView>
                ))}
              </div>
              <GalleryPagination
                page={searchResult.page}
                total={searchResult.total}
                pageSize={searchResult.pageSize}
                hasMore={searchResult.hasMore}
                onPageChange={setSearchPage}
              />
            </>
          ) : (
            <p className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No models match your search. Try different keywords.
            </p>
          )}
        </div>
      )}

      {/* ── Categories View ────────────────────────────────────────── */}
      {view === "categories" && (
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-[hsl(var(--foreground))]">
            Categories
          </h2>

          {categoriesLoading ? (
            renderSkeletonGrid(8)
          ) : categoriesResult && categoriesResult.items.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {categoriesResult.items.map((cat, i) => (
                  <RevealOnView key={cat.id} delay={(i % 4) * 50}>
                    <CategoryCard category={cat} />
                  </RevealOnView>
                ))}
              </div>
              <GalleryPagination
                page={categoriesResult.page}
                total={categoriesResult.total}
                pageSize={categoriesResult.pageSize}
                hasMore={categoriesResult.hasMore}
                onPageChange={setCategoriesPage}
              />
            </>
          ) : (
            <p className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No categories with models available yet.
            </p>
          )}
        </div>
      )}

      {/* ── Category Detail View ───────────────────────────────────── */}
      {view === "category-detail" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Link
              to="/gallery"
              className="flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] transition hover:text-[hsl(var(--foreground))]"
            >
              <ArrowLeft className="h-4 w-4" />
              All Categories
            </Link>
            <span className="text-sm text-[hsl(var(--muted-foreground))]">/</span>
            <h2 className="text-lg font-medium text-[hsl(var(--foreground))]">
              {categoryName || "Category"}
            </h2>
            {modelsResult && (
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                ({modelsResult.total} models)
              </span>
            )}
          </div>

          {modelsLoading ? (
            renderSkeletonGrid(8)
          ) : modelsResult && modelsResult.items.length > 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {modelsResult.items.map((model, i) => (
                  <RevealOnView key={model.id} delay={(i % 4) * 50}>
                    <div id={`model-${model.id}`} className="rounded-lg transition-all duration-300">
                      <ModelCard model={model} />
                    </div>
                  </RevealOnView>
                ))}
              </div>
              <GalleryPagination
                page={modelsResult.page}
                total={modelsResult.total}
                pageSize={modelsResult.pageSize}
                hasMore={modelsResult.hasMore}
                onPageChange={setModelsPage}
              />
            </>
          ) : (
            <p className="py-12 text-center text-sm text-[hsl(var(--muted-foreground))]">
              No approved models in this category yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
