# FreeCAD Integration Ideas

## Background

Chat3D currently generates 3D models via Build123d Python code, rendered by an external service into .3mf, .step, and .stl files. This document explores how FreeCAD could be integrated as an additional modeling target or companion tool.

## Key Facts

- **Build123d** (Chat3D's current engine) and **CadQuery** are both Python wrappers around OpenCASCADE — the same geometry kernel FreeCAD uses. They are not FreeCAD's native API.
- **FreeCAD's native scripting** uses its own Python modules (`FreeCAD`, `Part`, `PartDesign`, `Sketcher`) — a different API surface entirely.
- **STEP** is the universal exchange format all three understand natively.
- Build123d and CadQuery share the same author. CadQuery is the predecessor; Build123d is the more modern, declarative successor.

## Integration Paths

### Option 1: STEP File Exchange (works today)

Chat3D already produces `.step` files from Build123d output. Users can download and open them in FreeCAD.

**Enhancements:**
- A FreeCAD macro/addon that pulls STEP files from Chat3D's API directly
- A "Open in FreeCAD" deep-link or one-click download button in the frontend

**Effort:** Minimal — no backend changes needed.

**Limitation:** Imports as a dumb solid (BRep shape) — no parametric feature tree in FreeCAD. Users cannot go back and change sketch dimensions or feature parameters.

### Option 2: FreeCAD Python Script Generation (new codegen target)

Add a second codegen LLM purpose that outputs FreeCAD-native Python scripts instead of Build123d code.

**Required infrastructure:**
- A headless FreeCAD Docker service (FreeCAD supports `--console` / `freecadcmd` mode)
- New system prompts and few-shot examples for FreeCAD's PartDesign API
- Script execution service that produces `.FCStd` files (FreeCAD's native format)
- The output would include a full parametric feature tree (Sketch → Pad → Pocket → Fillet, etc.)

**Effort:** Significant.

**Challenges:**
- FreeCAD's API is more verbose and GUI-oriented than Build123d's functional/declarative style
- LLMs have less training data on FreeCAD scripting compared to Build123d/CadQuery
- The feature-tree approach (create sketch, constrain, extrude, boolean) is harder for LLMs to produce correctly vs. Build123d's composable operations
- Error handling and validation would need a separate pipeline

**Benefit:** Full parametric models that users can modify in FreeCAD's GUI.

### Option 3: CadQuery as a Bridge

CadQuery is syntactically close to Build123d (same author, same geometry kernel). There is a FreeCAD CadQuery workbench that can run CadQuery scripts inside FreeCAD.

**Approach:**
- Add a CadQuery codegen target (relatively easy since syntax is similar to Build123d)
- Users import CadQuery scripts in FreeCAD via the CadQuery workbench plugin

**Effort:** Moderate — mostly new system prompts and minor pipeline changes.

**Limitation:** Still no native FreeCAD parametric feature tree — it is a CadQuery script running inside FreeCAD, producing a shape without editable feature history.

### Option 4: FreeCAD Addon with Embedded Chat

A FreeCAD plugin that provides a chat panel within FreeCAD, calls Chat3D's backend API, and imports results directly into the active document.

**Approach:**
- FreeCAD addons are Python-based with PySide2/Qt UI — well-documented pattern
- The addon would authenticate against Chat3D's API, send prompts, poll for results
- Results imported as STEP (short term) or native FreeCAD scripts (long term)
- Could show 3D model directly in FreeCAD's viewport instead of the browser

**Effort:** Moderate for STEP-based version, significant if combined with native script generation.

## Recommendation

A phased approach, ordered by effort and value:

| Phase | Approach | Value | Effort |
|-------|----------|-------|--------|
| 1 | Document STEP workflow, add download UX improvements | Users can already use FreeCAD today | Minimal |
| 2 | FreeCAD addon + STEP import | Chat inside FreeCAD, auto-import results | Moderate |
| 3 | CadQuery codegen target | Alternative engine, works in FreeCAD workbench | Moderate |
| 4 | Native FreeCAD script generation | Full parametric models with feature trees | Significant |

The key question driving prioritization: **do users need parametric feature trees in FreeCAD, or is solid geometry (from STEP) sufficient?** If they just need to view, measure, or do light modifications, STEP is fine. If they need to go back and change sketch dimensions or feature parameters, native FreeCAD scripting (Option 2) is the long-term goal.

## Open Questions

- What FreeCAD version to target? (0.21+ has significant API improvements)
- Is there demand for FreeCAD integration from current users?
- Could we leverage FreeCAD's built-in Python console to run Build123d scripts directly (since both use OpenCASCADE)?
- Should the FreeCAD addon be open-sourced separately to attract the FreeCAD community?
