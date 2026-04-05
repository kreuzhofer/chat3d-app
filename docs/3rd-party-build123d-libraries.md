# Third-Party Build123d Libraries

Research into the Build123d ecosystem to identify libraries that could simplify LLM-generated 3D model code in Chat3D's pipeline.

**Date:** 2026-03-10 (updated 2026-04-05)
**Context:** bd_warehouse and gridfinity_build123d are integrated. This document surveys the full ecosystem for additional candidates.

---

## Tier 1: Strong Candidates for Integration

### py_gearworks — Advanced Gear Generation

- **GitHub:** [GarryBGoode/py_gearworks](https://github.com/GarryBGoode/py_gearworks)
- **Install:** `pip install git+https://github.com/GarryBGoode/py_gearworks`
- **Status:** Active, early stage

Native build123d gear library with spur gears, meshing, backlash, and profile shift. While bd_warehouse already has a basic `SpurGear`, py_gearworks goes deeper with helical gears, meshing pairs, and gear trains.

**Why it fits:** Gears are one of the hardest things to model from primitives. An LLM calling `SpurGear(num_teeth=20, module=2, height=10)` is dramatically more reliable than computing involute profiles from scratch.

**Integration effort:** Low — pip install, add imports to execution template, add prompt section describing the API.

---

### bd_beams_and_bars — Structural Profiles (UPN, IPN, Flat Bars)

- **GitLab:** [experimentslabs/3d/bd_beams_and_bars](https://gitlab.com/experimentslabs/3d/bd_beams_and_bars)
- **Docs:** [bd-beams-and-bars.3d.experimentslabs.com](https://bd-beams-and-bars.3d.experimentslabs.com/)
- **Install:** `pip install git+https://gitlab.com/experimentslabs/3d/bd_beams_and_bars.git`
- **Status:** Active

Generates 2D cross-sections (`FLSection`) and 3D beams (`FLBeam`) for standard structural profiles — UPN, IPN, UPE channels, flat bars.

**Why it fits:** Users asking for brackets, frames, and structural parts benefit from standard profiles rather than manual extrusions.

**Integration effort:** Low — pip install from git, add to template.

---

### gridfinity_build123d — Gridfinity Storage System — ✅ Integrated

- **GitHub:** [Ruudjhuu/gridfinity_build123d](https://github.com/Ruudjhuu/gridfinity_build123d)
- **Docs:** [gridfinity-build123d.readthedocs.io](https://gridfinity-build123d.readthedocs.io/)
- **Install:** `pip install git+https://github.com/Ruudjhuu/gridfinity_build123d`
- **Status:** Active, **integrated into Chat3D**

The most modular Gridfinity tool available — supports arbitrary shapes via grid definitions, not just rectangles.

**Why it fits:** Gridfinity is hugely popular in the 3D printing community. "Make me a Gridfinity bin for my screwdrivers" is a very natural prompt.

**Integration:** Done — installed in Build123d service `requirements.txt`, system prompt guidance in `prompts/gridfinity-prompts.ts`.

---

## Tier 2: Worth Evaluating

### bd_vslot — V-Slot Linear Rail Components

- **GitHub:** [keeeal/bd-vslot](https://github.com/keeeal/bd-vslot)
- **Docs:** [bd-vslot.readthedocs.io](https://bd-vslot.readthedocs.io/en/latest/)
- **Status:** Active

OpenBuilds-style aluminum extrusion profiles and accessories for V-Slot linear rail systems.

**Why it fits:** Common in CNC/3D printer frame designs. Niche but exactly the kind of geometry that's painful to model manually.

---

### build123d_draft — Line-Building Helpers

- **GitHub:** [baverman/build123d_draft](https://github.com/baverman/build123d_draft)
- **Status:** WIP

Shortcuts for wire construction: easy filleting, trimming, close-by-axis, mirror-by-axis, and slot creation (`make_slot`, `make_hslot`).

**Why it fits:** LLMs frequently struggle with complex sketch construction. Simplified helpers could reduce error rates.

**Concern:** WIP status — may not be stable enough for production use.

---

### bumo — Mutation-Based Modeling

- **PyPI:** [bumo](https://pypi.org/project/bumo/)
- **Status:** Published on PyPI

Adds a `Builder` class that mutates CAD objects in-place rather than creating new instances. Tracks operation history and supports face coloration based on operations.

**Why it fits:** The imperative mutation style might produce simpler LLM code than build123d's functional approach.

**Concern:** Adds a different paradigm that could confuse the LLM if mixed with standard build123d patterns.

---

## Tier 3: Useful for the Pipeline (Not for Code Generation)

### ~~Fusion360GalleryDataset-build123d~~ — Not Usable

- **GitHub:** [zalo/Fusion360GalleryDataset-build123d](https://github.com/zalo/Fusion360GalleryDataset-build123d)
- **Status:** Evaluated and **rejected**

7,683 Fusion 360 models auto-converted to Build123d scripts. **Not usable for Chat3D:**
- **Non-commercial license** (Autodesk Fusion 360 Gallery Dataset terms) — prohibits use in commercial products
- **Sketch-and-extrude only** — no fillets, chamfers, revolves, sweeps, lofts, mirrors, or patterns
- **Raw OCP bindings** — many models use `Geom_BSplineCurve` / `BRepBuilderAPI_MakeEdge` directly, not idiomatic Build123d
- **Fixed dimensions** — hardcoded values, not parametric

---

### Build123d-Cookbook — LLM Training Examples

- **GitHub:** [khaledelhady44/Build123d-Cookbook](https://github.com/khaledelhady44/Build123d-Cookbook)
- **Status:** Active

Community-driven collection of build123d scripts specifically designed for building datasets to train LLMs.

---

### build123d-introductory-examples-llm

- **GitHub:** [mohankumargupta/build123d-introductory-examples-llm](https://github.com/mohankumargupta/build123d-introductory-examples-llm)

Build123d examples formatted for LLM consumption.

---

## Tier 4: Too Niche for Now

| Library | What it does | Why skip |
|---------|-------------|---------|
| **capistry** ([GitHub](https://github.com/larssont/capistry)) | Parametric keyboard keycaps | Too domain-specific |
| **gflabel** ([GitHub](https://github.com/ndevenish/gflabel)) | 3D-printable Gridfinity labels | gridfinity_build123d covers this better |
| **gfthings** ([GitHub](https://github.com/PaulBone/gfthings)) | Gridfinity bins and grids | gridfinity_build123d covers this better |
| **IgnisCAD** ([GitHub](https://github.com/Ignis-Studio/IgnisCAD)) | AI-agent CAD wrapper | Low maturity (42 commits, 2 stars) |
| **build123things** ([GitHub](https://github.com/comrob/build123things)) | Assembly framework with `Thing` classes | Overkill for single-part generation |
| **partomatic** ([GitHub](https://github.com/x0pherl/partomatic)) | YAML-driven parametric part CI/CD | CI/CD focused, not LLM-relevant |
| **bd_tube_boxes** ([GitLab](https://gitlab.com/experimentslabs/3d/bd_tube_boxes)) | Boxes from recycled tubes | Extremely niche |
| **thingsmith** ([GitHub](https://github.com/davidharrigan/thingsmith)) | Parametric 3D printable models | Low activity |

---

## Competitive Landscape

Several projects are doing similar AI + build123d work:

| Project | Type | Notable Approach |
|---------|------|-----------------|
| **neThing.xyz** ([site](https://nething.xyz/)) | Commercial (polySpectra) | LlamaIndex + AstraDB RAG, achieved 5x token reduction |
| **Torrify** ([GitHub](https://github.com/caseyhartnett/Torrify)) | Open source desktop app | Multi-provider LLM, parameter sliders for tweaking |
| **Forma AI Service** ([GitHub](https://github.com/andreyka/forma-ai-service)) | Open source | Multi-agent (Designer + Coder), ChromaDB RAG, visual self-correction |
| **KATALYST** ([GitHub](https://github.com/katalyst-labs-os/katalyst-core)) | Open source | Building 500+ example dataset for fine-tuning |
| **CAD Agent** ([GitHub](https://github.com/Svetlana-DAO-LLC/cad-agent)) | Open source | HTTP rendering server, very similar architecture to Chat3D |
| **BuildCAD AI** ([site](https://buildcad.ai/)) | Commercial | Cloud-based, provides MCP server for Claude/Cursor |
| **CICADA** ([GitHub](https://github.com/Oaklight/cicada)) | Research | Collaborative agent framework for CAD automation |

---

## Viewer and Tooling Ecosystem (Reference)

| Tool | Purpose |
|------|---------|
| **ocp-vscode** ([GitHub](https://github.com/bernhard-42/vscode-ocp-cad-viewer)) | Primary VS Code viewer for build123d |
| **Yet Another CAD Viewer** ([GitHub](https://github.com/yeicor-3d/yet-another-cad-viewer)) | Web-based viewer with playground |
| **OCP.wasm** ([GitHub](https://github.com/Yeicor/OCP.wasm)) | Build123d in the browser via WebAssembly |
| **nice123d** ([GitHub](https://github.com/jdegenstein/nice123d)) | NiceGUI-based parametric editor |
| **PartCAD** ([GitHub](https://github.com/partcad/partcad)) | Package manager for CAD models ("npm for CAD") |
| **ocp-freecad-cam** ([GitHub](https://github.com/voneiden/ocp-freecad-cam)) | CAM toolpath generation from build123d |
| **diff3d** ([GitHub](https://github.com/bdlucas1/diff3d)) | Visual 3D diff for STL/STEP/3MF files |

---

## Recommendations

### Already Integrated

- ~~**bd_warehouse**~~ ✅ Parametric mechanical components (fasteners, bearings, gears)
- ~~**gridfinity_build123d**~~ ✅ Gridfinity storage bins

### Next Up

1. **py_gearworks** — Fills gaps where bd_warehouse's gear support is limited (small effort)
2. **bd_beams_and_bars** — Structural engineering use cases (small effort)

### Evaluate Further

4. **bd_vslot** — Worth adding if frame/rail requests are common
5. **build123d_draft** — Evaluate if LLM sketch construction errors remain a pain point

### Integration Pattern

The pattern is established from bd_warehouse:

1. Add to `requirements.txt` in the build123d service
2. Pre-import in the code execution template
3. Add a prompt section with usage guidance and API reference
4. Index examples into the knowledge base for RAG retrieval
