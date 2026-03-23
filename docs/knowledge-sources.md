# Knowledge Base — External Sources

> **Status:** Living document — updated 2026-03-09

This document tracks all external sources used (or planned) for the Chat3D knowledge base. The knowledge base provides RAG context to improve Build123d code generation quality.

---

## Currently Active Sources

### Build123d Core

| Source | Strategy | Entries | Description |
|--------|----------|---------|-------------|
| **Build123d GitHub Examples** | `github_file` | 65 | Complete working scripts from `gumyr/build123d/examples/` (builder + algebra modes) |
| **Build123d GitHub Tests** | `github_test_functions` | 230 | Individual test functions demonstrating API usage from `gumyr/build123d/tests/` |
| **Build123d Docs Python Files** | `github_file` | 48 | Python files from `gumyr/build123d/docs/` directory |
| **Build123d ReadTheDocs** | `readthedocs` | 209 | Python code blocks extracted from 34 documentation pages |
| **Build123d Cookbook** | `github_file` | 1 | Community examples for LLM training from `khaledelhady44/Build123d-Cookbook/examples/` |

**ReadTheDocs pages crawled (34):**
`introductory_examples`, `examples_1`, `tttt`, `tutorial_design`, `tutorial_lego`, `tutorial_joints`, `tutorial_surface_modeling`, `tutorial_surface_heart_token`, `tutorial_spitfire_wing_gordon`, `tutorial_selectors`, `tutorial_constraints`, `tech_drawing_tutorial`, `key_concepts_builder`, `key_concepts_algebra`, `OpenSCAD`, `cheat_sheet`, `objects`, `operations`, `topology_selection`, `builders`, `build_line`, `build_sketch`, `build_part`, `joints`, `assemblies`, `tips`, `import_export`, `advanced`, `location_arithmetic`, `moving_objects`, `algebra_performance`, `debugging_logging`, `center`, `algebra_definition`

### bd_warehouse (Parametric Parts)

| Source | Strategy | Entries | Description |
|--------|----------|---------|-------------|
| **bd_warehouse Examples** | `github_file` | 5 | Usage examples from `gumyr/bd_warehouse/examples/` |
| **bd_warehouse Source Code** | `github_file` | 8 | Parametric part modules (`fastener.py`, `bearing.py`, `gear.py`, `thread.py`, `pipe.py`, `flange.py`, `sprocket.py`, `open_builds.py`) with real engineering dimensions |

### Community Tutorials

| Source | Strategy | Entries | Description |
|--------|----------|---------|-------------|
| **build123d for Noobs** | `readthedocs` | 27 | Beginner-focused docs from `cepeu.github.io/build123-for-noobs/` — primitives, OpenSCAD migration, visualization |

### Reference Knowledge (Tier 3 — Technical Specifications)

| Source | Strategy | Entries | Description |
|--------|----------|---------|-------------|
| **Connector & Fastener Dimensions** | `reference_upload` | ~12 | USB-C, USB-A, HDMI, HDMI Micro, barrel jack, RJ45, audio jack, pin header, and ISO metric fastener dimensions (M2–M8) |
| **3D Printing Design Guidelines** | `reference_upload` | ~3 | FDM tolerances, wall thickness, overhang angles, snap-fit clearances, hole compensation |
| **Development Board Datasheets** | `reference_upload` | ~6 | RPi 4 Model B, RPi Zero 2W, RPi Pico, Arduino Uno R3, Arduino Nano, ESP32-DevKitC V4 — board dimensions, mounting holes, port positions |
| **Prusa 3D Printing KB** | `reference_url` | ~13 | Crawled from Prusa help article on modeling for 3D printing (HTML → Markdown, heading-based chunks) |
| **Osban RPi Mounting** | `reference_url` | ~8 | RPi 3/4/5 mounting dimensions and screw hole specifications (HTML → Markdown, heading-based chunks) |

### Totals

| Metric | Count |
|--------|-------|
| Total entries | ~630 |
| Valid (pass syntax + build123d check) | ~576 |
| Embedded (vector indexed) | ~579 |
| Reference entries | ~38 |

---

## Completed Sources — Tier 3: Technical Specifications (DONE)

All Tier 3 sources have been implemented as reference knowledge entries. These support higher-complexity workbench categories (mechanical components, electronic components, enclosures, PCB cases). See the "Reference Knowledge" section above for the active sources and entry counts.

### What was added

**Development Board Datasheets** — RPi 4 Model B, RPi Zero 2W, RPi Pico, Arduino Uno R3, Arduino Nano, ESP32-DevKitC V4. Each entry includes board dimensions, mounting hole positions/diameters, and port locations. Sources: official datasheets, Osban coordinates, Adafruit drawings, Espressif user guide.

**Connector Dimensions** — USB-C (8.34×2.56mm), USB-A (11.5×4.5mm), HDMI Type A (13.9×4.45mm), HDMI Micro (5.83×2.20mm), barrel jack (5.5mm OD), RJ45 (~16×13.5mm), 3.5mm audio jack (6mm dia), 2.54mm pin header. Sources: USB-IF spec, HDMI spec, standard references.

**Fastener Dimensions** — ISO metric M2–M8 socket cap screw dimensions (pitch, head diameter, head height, hex socket size). Sources: ISO standards, bd_warehouse.

**3D Printing Constraints** — FDM tolerances, wall thickness, overhang angles, snap-fit clearances, hole compensation, bridge spans. Sources: Formlabs, JLC3DP, Prusa KB, 3DChimera, Hubs.

### Pre-retrieval mechanism

Reference knowledge is **not** passively searched via RAG. Instead, a **keyword-based pre-retrieval** system automatically injects matching reference entries into the codegen system prompt:

1. `REFERENCE_KEYWORDS` lookup table maps ~20 tag groups to keyword patterns (e.g., `"usb-c"` → `["usb-c", "usb type-c", "type-c", "usbc"]`)
2. Before code generation, `preRetrieveReferenceKnowledge()` scans the user prompt + interpretation for keyword matches
3. Matched entries are appended to the system prompt with explicit instruction: *"Use these exact dimensions and specifications"*
4. Implemented in both iteration loop (`query.service.ts`) and agent loop (`agent-codegen.service.ts`)

**Tested and verified:** Before/after comparisons show exact dimension usage (e.g., USB-C 8.34mm instead of hallucinated 8.94mm, exact RPi4 mounting hole positions, exact Arduino Uno hole coordinates).

---

## Planned Sources — Tier 4: Additional Repos & Research

### Build123d Ecosystem Libraries

| Source | URL | Description | Priority |
|--------|-----|-------------|----------|
| **gridfinity_build123d** | [github.com/Ruudjhuu/gridfinity_build123d](https://github.com/Ruudjhuu/gridfinity_build123d) | Gridfinity bins, baseplates (42mm grid standard) — **library integrated, knowledge entries planned** | High |
| **capistry** | [github.com/larssont/capistry](https://github.com/larssont/capistry) | Parametric keyboard keycap modeling | Low |
| **py_gearworks** | [github.com/GarryBGoode/py_gearworks](https://github.com/GarryBGoode/py_gearworks) | Involute gear generators | Low |
| **gflabel** | [github.com/ndevenish/gflabel](https://github.com/ndevenish/gflabel) | 3D-printable gridfinity labels | Low |
| **build123things** | [github.com/comrob/build123things](https://github.com/comrob/build123things) | OOP extension for build123d | Low |

### Community Projects (Real-World Code)

| Source | URL | Description | Priority |
|--------|-----|-------------|----------|
| **TTT Speed Modeling** | [github.com/baverman/build123d_draft](https://github.com/baverman/build123d_draft) | TooTallToby challenge parts | Medium |
| **Input Labs CAD** | [github.com/inputlabs/cad](https://github.com/inputlabs/cad) | Game controller housings | Low |
| **keeb_snakeskin** | [github.com/BlueDrink9/keeb_snakeskin](https://github.com/BlueDrink9/keeb_snakeskin) | PCB-to-enclosure generation | Medium |
| **fender-bender** | [github.com/x0pherl/fender-bender](https://github.com/x0pherl/fender-bender) | Multi-part filament buffer system | Low |

### Machine-Readable Spec Databases

| Source | URL | Format | Description | Priority |
|--------|-----|--------|-------------|----------|
| **FreeCAD FastenersWB** | [github.com/shaise/FreeCAD_FastenersWB](https://github.com/shaise/FreeCAD_FastenersWB) | 189 CSV files | ISO/DIN/ASME fasteners — most complete source | High |
| **BOLTS** | [boltsparts.github.io](https://boltsparts.github.io/) | YAML | 92 standards, 16 collections | Medium |
| **KiCad Footprints** | [gitlab.com/kicad/libraries/kicad-footprints](https://gitlab.com/kicad/libraries/kicad-footprints) | `.kicad_mod` | Precise PCB component footprint dimensions | Medium |
| **KiCad 3D Packages** | [kicad.github.io/packages3d](https://kicad.github.io/packages3d/) | STEP/VRML | 3D models for electronic components | Low |
| **TraceParts API** | [developers.traceparts.com](https://developers.traceparts.com/docs/api-related-to-the-product-content) | REST API | 111M+ CAD models in STEP format | Low |

### Research Papers

| Paper | URL | Key Insight |
|-------|-----|-------------|
| **CADFusion** | [arxiv.org/pdf/2501.19054](https://arxiv.org/pdf/2501.19054) | Visual feedback integration in LLM for text-to-CAD (relevant to VLM eval loop) |
| **LlamaIndex RAG for Build123d** | [llamaindex.ai blog](https://www.llamaindex.ai/blog/unlocking-the-3rd-dimension-for-generative-ai-part-1) | 5x token reduction, 80% cost savings using RAG for build123d |

---

## Adding New Sources — Implementation Guide

### Architecture Overview

The knowledge system is a pipeline: **Crawl → Validate → Embed → Search**.

```
Source Config (JSONB)
  → Strategy Dispatcher (crawlSource)
    → Strategy Implementation (crawlGitHubFiles, crawlReadTheDocs, etc.)
      → RawEntry[] (sourceUrl, title, description, code, concepts)
        → Deduplication (by sourceUrl per source)
          → Insert → Validate → Embed
```

All strategies produce the same `RawEntry` interface, so validation, embedding, and search work identically regardless of source type.

### Existing Strategies

#### `github_file` — Fetch Python files from a GitHub directory

**Config:**
```json
{
  "repo": "owner/name",
  "branch": "main",
  "directory": "src/package",
  "fileExtension": ".py",
  "skipPatterns": ["__init__*", "*_test*"],
  "githubToken": "optional-per-source-token"
}
```

**Behavior:**
- Recursively fetches all files from `directory` via GitHub API
- Filters by `fileExtension` and `skipPatterns` (glob matching)
- Skips files lacking Build123d markers (`build123d`, `BuildPart`, `BuildSketch`)
- Extracts title from filename, description from docstring/comments
- `sourceUrl` = `https://github.com/{repo}/blob/{branch}/{path}`

**Best for:** Example scripts, library source code, standalone Python files.

#### `github_test_functions` — Extract individual test functions

**Config:**
```json
{
  "repo": "owner/name",
  "branch": "dev",
  "directory": "tests",
  "functionPrefix": "test_",
  "minCodeLength": 100,
  "githubToken": "optional"
}
```

**Behavior:**
- Fetches test files matching `test_build_*.py`, `test_algebra.py`, `test_build_generic.py`
- Splits files into individual functions by regex (`def test_...`)
- Filters by `functionPrefix`, `minCodeLength`, and presence of build123d API calls
- Creates one entry per function with `#functionName` URL fragment

**Best for:** Build123d test suites that demonstrate individual API patterns.

#### `readthedocs` — Extract code blocks from HTML documentation

**Config:**
```json
{
  "baseUrl": "https://docs.example.com/en/latest",
  "pages": ["tutorial.html", "api/objects.html", "examples/"]
}
```

**Behavior:**
- Fetches each page as HTML, parses with Cheerio
- Selectors: `div.highlight-python pre`, `div.highlight-default pre`, `div.highlight pre`, `pre.literal-block`
- Also works with MkDocs Material theme (`div.highlight pre`)
- Filters code blocks ≥ 80 chars containing Build123d markers
- Extracts nearest heading as title, preceding paragraph as description
- Rate-limited: 500ms between pages
- `sourceUrl` = `{baseUrl}/{page}#{heading-slug}`

**Best for:** ReadTheDocs sites, MkDocs sites, Sphinx documentation, any site with Python code blocks in `<pre>` tags.

#### `manual` — Admin-created entries via UI/API

**Config:** `{}` (empty)

**Behavior:** No crawling. Entries are created individually via `POST /api/admin/knowledge/entries`.

**Best for:** Hand-curated examples, converted code, custom reference material.

#### `reference_upload` — Admin-created reference entries via UI

**Config:** `{}` (empty)

**Behavior:** No crawling. Reference entries created individually via "Add Reference" button in the Knowledge admin tab. Content stored as Markdown in the `code` field. Auto-validated (no syntax/marker checks). Tags stored in `concepts` field.

**Best for:** Curated dimension specs, design guidelines, datasheet summaries — anything that isn't executable code but helps the LLM generate better models.

#### `reference_url` — Fetch and convert reference content from URL

**Config:**
```json
{
  "url": "https://example.com/article",
  "format": "html",
  "chunkStrategy": "heading",
  "maxChunkTokens": 1000,
  "tags": ["connector", "usb-c"]
}
```

**Behavior:**
- Fetches the URL content and converts to Markdown based on format
- Supported formats: `html` (content extraction via Cheerio, table conversion), `md` (stored as-is)
- PDF support deferred (requires `pdf-parse` dependency)
- Chunks content based on `chunkStrategy`: `heading` (split on `##`), `fixed` (token-based with overlap), `none` (store whole document)
- Each chunk stored as a reference entry with configured tags
- Auto-validated, then embedded

**Best for:** Blog posts, knowledge base articles, spec pages, any web content with structured headings.

### How to Add a Source (Step by Step)

**Via API:**
```bash
# 1. Create the source
curl -X POST http://localhost/api/admin/knowledge/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My New Source",
    "strategy": "github_file",
    "config": { "repo": "owner/repo", "branch": "main", "directory": "examples", "fileExtension": ".py" }
  }'

# 2. Trigger crawl (returns jobId)
curl -X POST http://localhost/api/admin/knowledge/sources/{sourceId}/crawl \
  -H "Authorization: Bearer $TOKEN"

# 3. Poll job status
curl http://localhost/api/admin/knowledge/jobs/{jobId} \
  -H "Authorization: Bearer $TOKEN"

# 4. Validate new entries
curl -X POST http://localhost/api/admin/knowledge/validate \
  -H "Authorization: Bearer $TOKEN"

# 5. Embed valid entries
curl -X POST http://localhost/api/admin/knowledge/embed \
  -H "Authorization: Bearer $TOKEN"
```

**Via Admin UI:** Navigate to Admin → Knowledge tab. Use "Add Source" button, configure, then use the crawl/validate/embed buttons.

### Validation Pipeline Details

Validation runs in two stages:

1. **Build123d marker check** (fast, no external call): Code must contain at least one of: `BuildPart`, `BuildSketch`, `BuildLine`, `Box`, `Cylinder`, `Sphere`, `Cone`, `Torus`, `Wedge`, `extrude`, `revolve`, `sweep`, `loft`, `fillet`, `chamfer`, `offset`, `Circle`, `Rectangle`, `Polygon`, `Ellipse`, `Locations`, `GridLocations`, `PolarLocations`, `Mode.ADD`, `Mode.SUBTRACT`, `Mode.INTERSECT`, `build123d`. If none found → `invalid`.

2. **Python syntax check** (calls Build123d service `/validate/` endpoint): Checks for Python syntax errors only (`skip_root_part: true`, `skip_lint: true`).

**Design decision:** Only Build123d code is accepted. Code without Build123d markers fails Stage 1 and is filtered out at crawl time.

### Concept Extraction

The system extracts ~45 concept tags via regex pattern matching on code. Concepts are stored as a `TEXT[]` array with a GIN index for fast filtering. Current patterns cover:

- **Primitives:** `box`, `cylinder`, `sphere`, `cone`, `torus`, `wedge`
- **2D primitives:** `circle`, `rectangle`, `polygon`, `line`, `arc`, `spline`, `text`
- **Operations:** `extrude`, `revolve`, `sweep`, `loft`, `fillet`, `chamfer`, `offset`, `shell`
- **Builders:** `BuildPart`, `BuildSketch`, `BuildLine`
- **Patterns:** `locations`, `grid_pattern`, `polar_pattern`, `hex_pattern`
- **Boolean:** `boolean_subtract`, `boolean_intersect`, `boolean_add`
- **Advanced:** `helix`, `joint`, `make_face`, `thicken`, `split`, `mirror`, `sketch_on_face`, `color`
- **I/O:** `import`, `export`

### Embedding & Search

- **Model:** OpenAI `text-embedding-3-large` at 1536 dimensions
- **Embedding text:** Code entries: `{title}\n\n{description}\n\n{first 500 chars of code}`. Reference entries: `{title}\n\n{description}\n\n{first 2000 chars of content}`
- **Index:** pgvector HNSW with cosine distance (`<=>` operator)
- **Search:** `searchKnowledge(query, limit=5)` returns top-K valid entries by cosine similarity
- **Deduplication:** By `sourceUrl` per source (same URL in different sources is allowed)

### Adding New Crawl Strategies

To support a new source type (e.g., CSV files, YAML specs, PDF docs), the following files need changes:

**1. `knowledge-source.service.ts`** — Add to `SourceStrategy` type union, add config interface, add validation rules:
```typescript
// Add to SourceStrategy union:
export type SourceStrategy = "github_file" | "github_test_functions" | "readthedocs" | "manual" | "reference_upload" | "reference_url" | "csv_specs";

// Add config interface:
export interface CsvSpecsConfig {
  repo: string;
  branch: string;
  directory: string;
  fileExtension: string;      // ".csv"
  codeColumnTemplate: string; // Template to generate code from CSV rows
}

// Add validation case in validateSourceConfig()
```

**2. `knowledge-crawl.service.ts`** — Add crawl function and dispatch case:
```typescript
// Add to STRATEGY_SOURCE_TYPE:
csv_specs: "specs",

// Add dispatch case in crawlSource():
case "csv_specs":
  entries = await crawlCsvSpecs(config as unknown as CsvSpecsConfig);
  break;

// Implement crawl function:
async function crawlCsvSpecs(cfg: CsvSpecsConfig): Promise<RawEntry[]> { ... }
```

**3. Prisma schema** — Update the `strategy` column `@db.VarChar(30)` constraint if needed (current 30 chars is sufficient for most names).

No changes needed to validation, embedding, search, job queue, admin routes, or frontend — they all work on the generic `RawEntry` / `Build123dKnowledge` interface.

---

## Reference Knowledge Pipeline (Implemented)

### Problem (Solved)

The knowledge base originally only handled Python code entries. Many valuable sources for improving code generation are **not code** — they're dimensional specs, design guidelines, connector standards, and engineering reference data. These required a different pipeline, which is now fully implemented.

### Design Goals

- **Same database** — reference knowledge lives in the existing `build123d_knowledge` table, using new `source_type` values (e.g., `reference`, `specs`, `guidelines`) to distinguish from code entries
- **Same embedding/search infrastructure** — pgvector HNSW, same `searchKnowledge()` function, results returned alongside code examples
- **Admin-driven workflow** — sources identified collaboratively (discussion or research), then added via Admin UI or API
- **Format-agnostic ingestion** — any input format accepted, everything converted to Markdown before storage
- **Markdown as the canonical format** — all reference content stored as `.md` in the `code` field (repurposed; it's the main content field)

### Workflow

```
1. Identify source (human decision — discussion, research, manual discovery)
2. Add source via Admin UI or API
   - Provide URL (fetched automatically) or direct file upload
   - Select strategy: "reference_url" or "reference_upload"
3. Backend converts non-Markdown formats to Markdown:
   - PDF → Markdown (via pdf-parse + LLM summarization for complex layouts)
   - CSV → Markdown tables
   - YAML → Markdown (structured key-value or tables)
   - HTML → Markdown (extract content, strip nav/chrome)
   - .md → stored as-is
4. Admin reviews/edits the converted Markdown in the UI (optional)
5. Chunking: split large documents into semantically meaningful sections
6. Store chunks as entries with source_type = "reference"
7. Embed with full-text composition (not code-truncated)
8. Available via searchKnowledge() alongside code entries
```

### Ingestion Strategies

#### `reference_url` — Fetch and convert from URL

**Config:**
```json
{
  "url": "https://example.com/spec.pdf",
  "format": "pdf",
  "chunkStrategy": "heading",
  "maxChunkTokens": 1000,
  "tags": ["connector", "usb-c"]
}
```

**Supported formats:**
- `pdf` — Extract text via `pdf-parse`, convert tables to Markdown tables, use LLM for complex multi-column layouts
- `csv` — Parse rows, generate Markdown tables with configurable grouping (e.g., group by fastener size range)
- `yaml` — Parse structure, render as Markdown sections with tables
- `html` — Strip to content, convert to Markdown (similar to readthedocs strategy but stores prose, not code blocks)
- `md` — Fetch and store directly

#### `reference_upload` — Direct file upload via Admin UI

**Config:**
```json
{
  "format": "auto",
  "chunkStrategy": "heading",
  "maxChunkTokens": 1000,
  "tags": ["fastener", "iso-4762"]
}
```

- File uploaded via `POST /api/admin/knowledge/sources/:id/upload` (multipart form, same pattern as existing file upload)
- Format auto-detected from extension, or manually specified
- Converted to Markdown, then chunked and stored

### Chunking Strategies

Large documents must be split into chunks small enough for meaningful embedding but large enough to be self-contained.

| Strategy | Behavior | Best for |
|----------|----------|----------|
| `heading` | Split on `##` headings, keep each section as one chunk | Structured docs, specs with clear sections |
| `fixed` | Split every N tokens with overlap | Unstructured prose, blog posts |
| `table` | One chunk per table (with its preceding heading/context) | CSV-derived content, spec tables |
| `manual` | No auto-chunking — admin manually creates entries | Small, curated reference docs |
| `none` | Store entire document as one entry | Documents under maxChunkTokens |

Each chunk gets:
- **title**: extracted from nearest heading or generated from filename + chunk index
- **description**: first paragraph or surrounding context
- **code** (content field): the Markdown chunk itself
- **concepts**: tag-based (from config `tags` array), not regex-extracted
- **source_type**: `reference`

### Embedding Differences

For reference entries (`source_type = "reference"`), the embedding text composition changes:

```typescript
function buildEmbeddingText(entry): string {
  if (entry.sourceType === "reference") {
    // Full content for reference entries (capped at 2000 chars)
    return [entry.title, entry.description, entry.code.slice(0, 2000)].filter(Boolean).join("\n\n");
  }
  // Existing behavior for code entries
  return [entry.title, entry.description, entry.code.slice(0, 500)].filter(Boolean).join("\n\n");
}
```

Reference entries use more content (2000 chars vs 500) because prose is less information-dense than code.

### Validation Differences

Reference entries skip the Build123d marker check (Stage 1) and the Python syntax check (Stage 2). They are auto-validated on insert:

```typescript
if (sourceType === "reference") {
  // Auto-valid — no code markers or syntax to check
  validationStatus = "valid";
}
```

### Search Integration

`searchKnowledge()` returns both code and reference entries in a single ranked list. The caller (codegen pipeline) can filter by `source_type` if needed, but by default both types are returned — the vector similarity score determines relevance.

When a reference entry is returned as RAG context, it's injected differently in the codegen prompt:

```
## Reference: {title}
{content}
```

vs. code entries which are injected as:

```python
# Example: {title}
{code}
```

### How the LLM Gets Triggered to Use Reference Knowledge

This is the key design question. The reference knowledge is only useful if the codegen LLM actually incorporates it. Three approaches, from simplest to most sophisticated:

#### Approach 1: Passive RAG (simplest, implement first)

Reference entries are returned by `searchKnowledge()` alongside code examples. The system prompt instructs the LLM:

> *"When reference material is provided (dimensions, specifications, tolerances), use the exact values given. Do not guess or hallucinate dimensions — if a specification is provided, use it."*

The vector search naturally surfaces relevant specs when the user prompt mentions related terms (e.g., "USB-C" matches the USB-C connector dimensions entry).

**Limitation:** Depends entirely on embedding similarity. May miss relevant specs if the user prompt doesn't use the right terminology.

#### Approach 2: Tag-Based Retrieval (medium complexity)

Reference entries have explicit `tags` (e.g., `["usb-c", "connector"]`). After the conversation LLM identifies the user's intent (via tool_use), the codegen pipeline:

1. Extracts key nouns/entities from the prompt
2. Matches against reference entry tags (exact + fuzzy)
3. Injects matched reference entries into the codegen prompt, in addition to vector-searched code examples

This is similar to the Parts Knowledge Library keyword matching (§15 of workbench doc) but generalized to all reference content.

**Implementation:** Add a `tags TEXT[]` column to the knowledge table (or reuse the existing `concepts` field). Add a `searchKnowledgeByTags(tags[])` function. Call it in the codegen pipeline before building the prompt.

#### Approach 3: Two-Stage Retrieval with LLM Planning (most sophisticated)

Before code generation, a lightweight LLM call analyzes the user prompt and produces a retrieval plan:

```json
{
  "codeExamples": "cylindrical enclosure with snap-fit lid",
  "referenceNeeded": ["snap-fit design tolerances", "3D printing wall thickness"],
  "partDatasheets": ["raspberry-pi-4"]
}
```

Each field drives a separate search:
- `codeExamples` → vector search on code entries
- `referenceNeeded` → vector search on reference entries
- `partDatasheets` → keyword lookup on part datasheets (§15)

Results are combined and injected into the codegen prompt with clear section headers.

**Trade-off:** Extra LLM call adds latency and cost, but maximizes retrieval precision.

#### What Was Implemented

**Approach 1 (passive RAG)** was tried first but proved insufficient — the agent LLM never invoked the `search_reference` tool because it was confident from training data.

**Approach 2 (tag-based pre-retrieval)** was implemented and is the active approach. A `REFERENCE_KEYWORDS` lookup table in `knowledge.service.ts` maps ~20 tag groups to keyword patterns. Before code generation, `preRetrieveReferenceKnowledge()` scans the prompt for matches and injects reference entries directly into the system prompt. This bypasses the agent's decision of whether to search and ensures exact dimensions are always available. See "Pre-retrieval mechanism" in the Tier 3 section above.

**Approach 3** (LLM planning) remains deferred — the keyword-based approach has proven effective in before/after testing.

### Implementation Phases

#### Phase R1 — Reference Entry Storage & Manual Workflow (DONE)

- [x] Add `source_type = "reference"` support to validation pipeline (auto-valid, skip marker check)
- [x] Add `reference_upload` strategy — create source, add entries via "Add Reference" button
- [x] Update `buildEmbeddingText()` to use 2000 chars for reference entries
- [x] Admin UI: "Add Reference" button with Markdown editor, tags, source URL
- [x] DB migration: `reference_upload` strategy + `reference` source type in check constraints

#### Phase R2 — URL Fetching & Format Conversion (DONE)

- [x] Add `reference_url` strategy — fetch URL, auto-detect format, crawlable
- [x] CSV → Markdown tables converter (`knowledge-convert.service.ts`)
- [x] HTML → Markdown converter (content extraction, strip navigation, table conversion)
- [x] Admin UI: URL input field, format selector
- [x] DB migration: `reference_url` strategy in check constraint
- [ ] PDF → Markdown converter (deferred — requires `pdf-parse` dependency)

#### Phase R3 — Chunking & Tags (DONE)

- [x] Implement chunking strategies: `heading` (split on ##), `fixed` (size-based with overlap), `none`
- [x] Tags stored in existing `concepts` field (TEXT[] with GIN index)
- [x] `searchKnowledgeByTags()` function — searches by tag overlap, ranked by match count
- [x] Admin UI: chunk strategy selector and tags input for `reference_url` sources
- [x] Admin UI: tags input in "Add Reference" dialog for `reference_upload` sources
- [x] `reference_url` crawl uses configured chunk strategy + tags

#### Phase R4 — Retrieval Optimization (DONE)

- [x] `search_reference` agent tool — tag-based retrieval for specs, dimensions, and engineering data
- [x] Updated `search_knowledge` tool description to mention reference material
- [x] Updated `search_knowledge` tool response formatting — reference entries rendered as Markdown prose instead of code blocks
- [x] System prompt updated to guide agent to use `search_reference` for component dimensions/specs
- [x] **Keyword-based pre-retrieval** — `REFERENCE_KEYWORDS` lookup + `preRetrieveReferenceKnowledge()` automatically injects matching reference entries into codegen system prompt (both iteration and agent loops)
- [x] **Before/after testing** — verified exact dimension usage for USB-C, HDMI, RPi4, Arduino Uno
- [ ] Two-stage retrieval with LLM planning (deferred — keyword pre-retrieval is sufficient)
- [ ] A/B test: code-only RAG vs. code + reference RAG (deferred — needs production data)

### Example Sources for Phase R1 (All Done)

All initially planned reference sources have been added:

| Source | Content | Status |
|--------|---------|--------|
| Raspberry Pi mechanical drawings | Board dims, mounting holes, port positions | Done (`reference_upload` + `reference_url` via Osban) |
| Arduino hole dimensions | Mounting patterns for Uno/Nano | Done (`reference_upload`) |
| ISO metric fastener table | M2–M8 socket cap screw dimensions | Done (`reference_upload`) |
| USB-C connector dimensions | Receptacle opening, depth, tolerances | Done (`reference_upload`) |
| FDM 3D printing guidelines | Wall thickness, overhangs, tolerances | Done (`reference_upload` + `reference_url` via Prusa KB) |
| Gridfinity specification | Grid size (42mm), height units (7mm), wall dimensions, magnet/screw dims | Planned — add after library integration |

Additional connectors also added: USB-A, HDMI, HDMI Micro, barrel jack, RJ45, audio jack, pin header.

---

## Notes

- **Only Build123d code** is accepted in the knowledge base. The crawl filter requires `build123d`, `BuildPart`, or `BuildSketch` markers.
- **Validation** checks Python syntax and presence of Build123d API markers in two stages.
- **Embedding** uses OpenAI `text-embedding-3-large` at 1536 dimensions with pgvector HNSW indexing.
- Sources are managed via Admin UI (Knowledge tab) or API (`/api/admin/knowledge/sources`).
- The knowledge system is highly modular — adding new source types requires only a strategy implementation and config definition. Validation, deduplication, embedding, and search work uniformly on all source types.
