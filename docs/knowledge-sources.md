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

### CadQuery Ecosystem — Removed

CadQuery sources were evaluated and intentionally excluded. While CadQuery shares the same OCCT kernel as Build123d, including CadQuery code in the RAG context risks the LLM reproducing CadQuery patterns (`cq.Workplane()`, `.cut()`, string selectors) instead of Build123d APIs. The crawl filter only accepts Build123d markers (`build123d`, `BuildPart`, `BuildSketch`).

CadQuery code can still be valuable as a *conversion source* — see §CadQuery-to-Build123d Conversion below for a planned LLM agent that would convert CadQuery examples to Build123d before ingestion.

### Community Tutorials

| Source | Strategy | Entries | Description |
|--------|----------|---------|-------------|
| **build123d for Noobs** | `readthedocs` | 27 | Beginner-focused docs from `cepeu.github.io/build123-for-noobs/` — primitives, OpenSCAD migration, visualization |

### Totals

| Metric | Count |
|--------|-------|
| Total entries | 593 |
| Valid (pass syntax + build123d check) | 538 |
| Embedded (vector indexed) | 541 |

---

## Planned Sources — Tier 3: Technical Specifications

These sources support the **Parts Knowledge Library** (see `build123d-llm-workbench.md` §15) and are needed for higher-complexity workbench categories (8–11: mechanical components, electronic components, enclosures, PCB cases).

### Development Board Datasheets

To be curated as structured Markdown files in `workbench/parts/`.

| Board | Dimensions (mm) | Mounting | Best Source |
|-------|-----------------|----------|-------------|
| Raspberry Pi 5/4/3 B+ | 85 x 56 | 4 holes M2.5, 58x49mm pattern | [Official mechanical PDFs](https://datasheets.raspberrypi.com/) + [Osban coordinates](https://osban.se/raspberry-pi-3-4-5-mounting-dimensions-and-screw-hole-specifications/) |
| Raspberry Pi Zero/Zero 2 W | 65 x 30 | 4 holes M2.5, 58x23mm pattern | [Official PDF](https://datasheets.raspberrypi.com/rpizero2/raspberry-pi-zero-2-w-mechanical-drawing.pdf) |
| Raspberry Pi Pico | 51 x 21, 1mm thick | 4 holes M2, 2.1mm dia | [Pico datasheet](https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf) |
| Arduino Uno R3 | 68.6 x 53.4 | 4 holes 3.2mm, M3 | [Adafruit drawing](https://cdn-shop.adafruit.com/datasheets/arduino_hole_dimensions.pdf) |
| Arduino Nano | 45 x 18 | No mounting holes | [docs.arduino.cc](https://docs.arduino.cc/hardware/nano) |
| ESP32-DevKitC V4 | 54.4 x 27.9 | — | [Espressif user guide](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html) |

### Connector Dimensions (for port cutouts)

| Connector | Opening (mm) | Source |
|-----------|-------------|--------|
| USB-A receptacle | 11.5 x 4.5 | USB-IF spec |
| USB-C receptacle | 8.34 x 2.56, 6.20mm deep | [USB Type-C Spec R2.0](https://www.usb.org/sites/default/files/USB%20Type-C%20Spec%20R2.0%20-%20August%202019.pdf) |
| HDMI Type A | 13.9 x 4.45 | HDMI spec |
| HDMI Micro (Type D) | 5.83 x 2.20 | HDMI spec |
| Barrel jack (DC) | 5.5mm OD, 2.1/2.5mm pin | Standard |
| 2.54mm pin header | 0.64mm pins, 2.54mm pitch | Standard |
| RJ45 (Ethernet) | ~16 x 13.5 | Standard |
| 3.5mm audio jack | 6mm dia | Standard |

### Fastener Dimensions

| Source | Format | Content |
|--------|--------|---------|
| [FreeCAD FastenersWB](https://github.com/shaise/FreeCAD_FastenersWB) | 189 CSV files | ISO/DIN/ASME fasteners M1.6–M64+. Best machine-readable source |
| [bd_warehouse](https://github.com/gumyr/bd_warehouse) | Python dicts | Already crawled — fasteners, bearings, threads in Build123d format |
| [BOLTS](https://boltsparts.github.io/) | YAML | 92 standards, 16 part collections |

**Key ISO metric fastener dimensions (commonly needed):**

| Size | Pitch (mm) | Socket cap head dia (mm) | Head height (mm) | Hex socket (mm) |
|------|-----------|-------------------------|-----------------|-----------------|
| M2 | 0.4 | 3.98 | 2.0 | 1.5 |
| M2.5 | 0.45 | 4.68 | 2.5 | 2.0 |
| M3 | 0.5 | 5.68 | 3.0 | 2.5 |
| M4 | 0.7 | 7.22 | 4.0 | 3.0 |
| M5 | 0.8 | 8.72 | 5.0 | 4.0 |
| M6 | 1.0 | 10.22 | 6.0 | 5.0 |
| M8 | 1.25 | 13.27 | 8.0 | 6.0 |

### 3D Printing Constraints

To be curated as `workbench/3d-printing-guidelines.md` (see `build123d-llm-workbench.md` §16).

| Constraint | FDM Value | Source |
|-----------|-----------|--------|
| Min wall thickness (supported) | 0.8mm | [Formlabs](https://formlabs.com/blog/minimum-wall-thickness-3d-printing/) |
| Min wall thickness (unsupported) | 1.2mm | Same |
| Max overhang angle (safe) | 45 deg | [JLC3DP](https://jlc3dp.com/help/article/3D-Printing-Design-Guideline) |
| Hole diameter compensation | +0.1–0.3mm | [Prusa KB](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135) |
| Clearance/sliding fit | 0.4–0.6mm gap | [3DChimera](https://3dchimera.com/blogs/connecting-the-dots/3d-printing-tolerances-fits) |
| Press fit (interference) | 0.0–0.1mm | Same |
| Snap-fit gap (FDM) | 0.5mm | [Hubs](https://www.hubs.com/knowledge-base/how-design-snap-fit-joints-3d-printing/) |
| Snap-fit gap (SLA/SLS) | 0.3mm | Same |
| Min printable thread (FDM) | M5+ printed, M3+ tapped | [Hubs assembly guide](https://www.hubs.com/knowledge-base/how-assemble-3d-printed-parts-threaded-fasteners/) |
| Max bridge span (reliable) | 10mm | General consensus |
| Base tolerance (FDM) | +/-0.15 to +/-0.3mm | Multiple sources |

---

## Planned Sources — Tier 4: Additional Repos & Research

### Build123d Ecosystem Libraries

| Source | URL | Description | Priority |
|--------|-----|-------------|----------|
| **gridfinity_build123d** | [github.com/Ruudjhuu/gridfinity_build123d](https://github.com/Ruudjhuu/gridfinity_build123d) | Gridfinity bins, baseplates (42mm grid standard) | Medium |
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

### CadQuery (Conversion Candidates Only)

These repos contain valuable designs but use CadQuery APIs. They should **not** be added as direct knowledge sources. Instead, use the CadQuery-to-Build123d conversion agent (see §CadQuery-to-Build123d Conversion) to translate them before ingestion.

| Source | URL | Description | Priority |
|--------|-----|-------------|----------|
| **CadQuery Contrib** | [github.com/CadQuery/cadquery-contrib](https://github.com/CadQuery/cadquery-contrib) | 15+ community scripts: enclosures, gears, braille, threads, molds | Medium |
| **cq-electronics** | [github.com/sethfischer/cq-electronics](https://github.com/sethfischer/cq-electronics) | Electronic component models: RPi 3B, RJ45, pin headers, BGA, DIN rail | Medium |
| **cq_warehouse** | [github.com/gumyr/cq_warehouse](https://github.com/gumyr/cq_warehouse) | CadQuery parametric parts (predecessor to bd_warehouse) | Low |
| **cq-gridfinity** | [github.com/michaelgale/cq-gridfinity](https://github.com/michaelgale/cq-gridfinity) | CadQuery gridfinity objects | Low |
| **cq_gears** | [github.com/meadiode/cq_gears](https://github.com/meadiode/cq_gears) | Involute gear generator | Low |

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
| **Text-to-CadQuery** | [arxiv.org/abs/2505.06507](https://arxiv.org/abs/2505.06507) | 170K text-CadQuery pairs dataset; scaling laws for CAD code generation |
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

**Design decision:** Only Build123d code is accepted. CadQuery code would fail Stage 1 (no build123d markers) and is filtered out at crawl time. This prevents the LLM from being distracted by CadQuery patterns (`cq.Workplane()`, `.cut()`, string selectors) when it should be generating Build123d code.

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
export type SourceStrategy = "github_file" | "github_test_functions" | "readthedocs" | "manual" | "csv_specs";

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

### Post-Crawl Transformation (Future)

For sources that need code transformation after crawl (e.g., CadQuery → Build123d conversion), the recommended architecture is a **config-driven transform pipeline** applied between crawl and insert:

```
crawl → [transform] → dedup → insert → validate → embed
```

This would require:
- Adding an optional `transforms` array to source configs
- Calling `applyTransforms(entries, config.transforms)` after the crawl function returns
- Each transform is a named operation (e.g., `cadquery_to_build123d`, `normalize_imports`)

See §CadQuery-to-Build123d Conversion below for details on the conversion transform.

---

## Reference Knowledge Pipeline (Planned)

### Problem

The current knowledge base only handles Python code entries. Many valuable sources for improving code generation are **not code** — they're dimensional specs, design guidelines, connector standards, and engineering reference data stored in PDFs, CSVs, YAML, HTML tables, or proprietary formats. These need a different pipeline to get into the knowledge base.

Examples: USB-C connector dimensions from a PDF spec, fastener tables from CSV files, PCB form factor specs from HTML pages, 3D printing tolerance guidelines from blog posts.

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

#### Recommendation

Start with **Approach 1** (passive RAG) — it requires no pipeline changes beyond storing and embedding reference entries. Add **Approach 2** (tag-based) when we have enough reference entries to warrant it. Consider **Approach 3** only if retrieval quality is demonstrably insufficient.

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
- [ ] Two-stage retrieval with LLM planning (deferred — evaluate need after reference entries accumulate)
- [ ] A/B test: code-only RAG vs. code + reference RAG (deferred — needs production data)

### Example Sources for Phase R1 (Manual Upload)

These could be added immediately once Phase R1 is implemented — manually download, convert to Markdown, upload:

| Source | Content | Format |
|--------|---------|--------|
| Raspberry Pi mechanical drawings | Board dims, mounting holes, port positions | PDF → Markdown |
| Arduino hole dimensions | Mounting patterns for Uno/Mega/Nano | PDF → Markdown |
| ISO metric thread table | M2–M8 pitch, major/minor diameters | Wikipedia HTML → Markdown table |
| USB-C connector dimensions | Receptacle opening, depth, tolerances | Spec PDF → Markdown |
| FDM 3D printing guidelines | Wall thickness, overhangs, tolerances | Blog posts → curated Markdown |
| Gridfinity specification | Grid size, height units, wall dimensions | Web page → Markdown |

---

## CadQuery-to-Build123d Conversion

### Background

CadQuery and Build123d both wrap the same OpenCascade (OCCT) kernel via shared Python bindings. Build123d was derived from CadQuery but uses a fundamentally different API style. No automated converter exists.

### API Differences

| Aspect | CadQuery | Build123d |
|--------|----------|-----------|
| **Style** | Fluent method chaining | Context managers (builder) or operators (algebra) |
| **Entry point** | `cq.Workplane("XY")` | `BuildPart()` / `BuildSketch()` |
| **State** | Implicit workplane tracking through chain | Explicit plane/face specification |
| **Booleans** | `.cut()`, `.union()`, `.intersect()` | `Mode.SUBTRACT` / `+=` / `-=` |
| **Selectors** | String-based: `">Z"`, `"\|Z"`, `"#Z"` | Method-based: `.sort_by()`, `.filter_by()`, `.group_by()` |
| **Assemblies** | Constraint-based | Joint-based (RigidJoint, RevoluteJoint) |
| **Debugging** | Difficult mid-chain | Standard Python (`print()` inside `with` blocks) |

### Key API Mapping

#### Primitives

| CadQuery | Build123d |
|----------|-----------|
| `.box(l, w, h)` | `Box(l, w, h)` |
| `.cylinder(h, r)` | `Cylinder(radius=r, height=h)` |
| `.sphere(r)` | `Sphere(radius=r)` |
| `.hole(d, depth)` | `Hole(radius=d/2, depth=depth)` |
| `.rect(l, w)` | `Rectangle(l, w)` |
| `.circle(r)` | `Circle(r)` |
| `.polygon(n, r)` | `RegularPolygon(radius=r, side_count=n)` |

#### Operations

| CadQuery | Build123d |
|----------|-----------|
| `.extrude(d)` | `extrude(amount=d)` |
| `.revolve(angle)` | `revolve(revolution_arc=angle)` |
| `.fillet(r)` | `fillet(edges, radius=r)` — requires explicit edge selection |
| `.chamfer(l)` | `chamfer(edges, length=l)` — requires explicit edge selection |
| `.shell(t)` | `offset(amount=-t, openings=face)` |
| `.cut(other)` | `mode=Mode.SUBTRACT` or `-=` |
| `.union(other)` | `mode=Mode.ADD` or `+=` |
| `.mirror(...)` | `mirror(about=Plane)` |

#### Selectors

| CadQuery Selector | Build123d Equivalent | Meaning |
|-------------------|---------------------|---------|
| `">Z"` | `.sort_by(Axis.Z)[-1]` | Farthest in +Z |
| `"<Z"` | `.sort_by(Axis.Z)[0]` | Nearest in -Z |
| `"\|Z"` | `.filter_by(Axis.Z)` | Parallel to Z |
| `"#Z"` | `.filter_by(Plane.XY)` | Perpendicular to Z |
| `">Z[-2]"` | `.sort_by(Axis.Z)[-2]` | 2nd from top |

#### Patterns & Locations

| CadQuery | Build123d |
|----------|-----------|
| `.rarray(xs, ys, xn, yn)` | `GridLocations(xs, ys, xn, yn)` |
| `.polarArray(r, start, stop, n)` | `PolarLocations(radius=r, count=n)` |
| `.pushPoints(pts)` | `Locations(*pts)` |

### Conversion Complexity Assessment

| Category | Convertible | Approach |
|----------|------------|----------|
| Primitive creation | ~95% | Direct mapping, mostly mechanical |
| Simple booleans | ~90% | Direct mapping |
| Basic extrude/revolve | ~90% | Direct mapping |
| Selector strings | ~75% | Formulaic but needs string parsing |
| Method chain restructuring | ~60% | Requires understanding implicit workplane state |
| Complex assemblies | ~40% | Different paradigm (constraints vs joints) |
| `twistExtrude()`, `interpPlate()` | 0% | No direct equivalent — must be reimplemented |

**Overall estimate:** 60-70% of CadQuery examples can be converted with high accuracy by an LLM.

### Recommended LLM Conversion Agent

An LLM-based conversion agent is the most practical approach. Design:

**System prompt contents:**
1. Complete API mapping table (above)
2. 5-10 side-by-side examples showing the same model in CadQuery and Build123d
3. Common pitfalls (CadQuery `hole(diameter)` vs Build123d `Hole(radius)`, implicit vs explicit selectors)
4. Output format requirements (standalone script with `from build123d import *`)

**Pipeline:**
```
CadQuery code
  → LLM conversion (system prompt + API mapping + few-shot examples)
    → Build123d code candidate
      → Execute via Build123d service (/validate/ or /render/)
        → Success: store as valid knowledge entry
        → Syntax error: feed error back to LLM for correction (up to 3 retries)
        → Geometry check: render both versions, compare volumes or Chamfer Distance
```

**Validation approaches (in order of complexity):**
1. **Execution test:** Does the Build123d code execute without errors?
2. **Volume comparison:** Compare solid volumes (should be identical)
3. **Visual comparison:** Render screenshots from standard viewpoints, compare via VLM
4. **Chamfer Distance:** Sample surface points from both meshes, compute distance metric

**Integration with knowledge system:**
- Add a `cadquery_to_build123d` transform type to the source config
- After crawling CadQuery code, run the LLM conversion on each entry
- Store original CadQuery source URL for provenance
- Store both the original and converted code (original as description, converted as code)
- Validate the converted code through the normal pipeline

**Expected accuracy with self-correction loop:** 75-85% for simple/medium complexity models, based on analogous results from Text-to-CadQuery research (53% first-attempt → 85% with feedback).

**Build123d Algebra mode** is the recommended conversion target — it's closer in spirit to CadQuery's sequential style than Builder mode, making the translation more direct.

### Key Sources

- [Build123d Introductory Examples](https://build123d.readthedocs.io/en/latest/introductory_examples.html) — 36 examples in both builder and algebra modes (usable as few-shot pairs)
- [Build123d Transitioning from OpenSCAD](https://build123d.readthedocs.io/en/latest/OpenSCAD.html) — philosophy and approach (no CadQuery equivalent exists)
- [Build123d Cheat Sheet](https://build123d.readthedocs.io/en/latest/cheat_sheet.html) — compact API surface reference
- [CadQuery Selectors Reference](https://cadquery.readthedocs.io/en/latest/selectors.html) — complete selector syntax
- [Text-to-CadQuery paper (arXiv:2505.06507)](https://arxiv.org/abs/2505.06507) — 170K training pairs, self-correction feedback loop
- [CAD-Coder paper (arXiv:2505.19713)](https://arxiv.org/abs/2505.19713) — chain-of-thought + geometric reward validation

---

## Notes

- **Only Build123d code** is accepted in the knowledge base. The crawl filter requires `build123d`, `BuildPart`, or `BuildSketch` markers. CadQuery code is intentionally excluded to prevent the LLM from reproducing CadQuery patterns instead of Build123d APIs. CadQuery sources should be converted to Build123d first (see §CadQuery-to-Build123d Conversion).
- **Validation** checks Python syntax and presence of Build123d API markers in two stages.
- **Embedding** uses OpenAI `text-embedding-3-large` at 1536 dimensions with pgvector HNSW indexing.
- Sources are managed via Admin UI (Knowledge tab) or API (`/api/admin/knowledge/sources`).
- The knowledge system is highly modular — adding new source types requires only a strategy implementation and config definition. Validation, deduplication, embedding, and search work uniformly on all source types.
