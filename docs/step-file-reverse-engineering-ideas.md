# STEP File Reverse Engineering — Feasibility Analysis

## Goal

Take a STEP file (B-rep geometry) as input and produce Build123d Python code that reconstructs the model, making it editable via Chat3D's natural language interface.

## Core Challenge

STEP files describe the **final shape** (boundary representation — surfaces, edges, topology), not the construction history. Going backwards from a finished solid to a sequence of sketches, extrusions, cuts, fillets, etc. is the **B-rep → parametric CSG** inverse problem. It has many valid solutions and is fundamentally hard.

## Approaches

### 1. Visual (VLM-based) — Easiest to Implement, Least Precise

- Render the uploaded STEP file from multiple angles (reuse the existing render service)
- Feed screenshots to a VLM + the codegen pipeline
- LLM proposes Build123d code based on what it "sees"

**Pros:**
- Leverages the existing two-stage pipeline almost as-is
- Minimal new infrastructure

**Cons:**
- Loses exact dimensions
- Struggles with internal features (holes, pockets, channels)
- Approximate at best

### 2. STEP Parsing + LLM — More Precise, More Work

- Parse the STEP file server-side to extract geometric primitives (planes, cylinders, cones, toruses), dimensions, and topology
- Feed structured geometric data to the LLM as context
- LLM proposes a construction sequence informed by actual measurements

**Pros:**
- Exact dimensions available to the LLM
- Could handle simple-to-medium parts well

**Cons:**
- STEP parsing is non-trivial (though libraries like `build123d`, `cadquery`, or `OCP` can do it server-side)
- LLM still has to infer construction intent from geometry data

### 3. Hybrid — Best Results

- Combine parsed geometry data (bounding box, face types, edge counts, key dimensions) with rendered views
- Give the LLM both structured data and visual context
- Best of both worlds: visual understanding + dimensional accuracy

## Expected Success by Part Complexity

| Part Type | Expected Accuracy | Notes |
|-----------|------------------|-------|
| Simple mechanical parts (boxes, cylinders, plates with holes, L-brackets, enclosures) | High | These map cleanly to basic Build123d operations |
| Extruded profiles (clearly a 2D sketch extruded) | Good | 2D sketch extraction is relatively tractable |
| Parts with obvious boolean operations (block with drilled holes) | Decent | LLM can infer cut operations from cylindrical voids |
| Organic/sculpted shapes, complex lofts, sweeps | Poor | No clear parametric decomposition |
| Parts with many fillets/chamfers | Poor | Hard to distinguish from base geometry |
| Assemblies or multi-body parts | Poor | Requires decomposition + individual reconstruction |
| Complex internal features not visible externally | Poor | Visual approach fails; parsing helps but is still hard |

## Pragmatic Implementation Path

### Phase 1 — Visual Approach (MVP)

Use the existing pipeline with minimal changes:

1. User uploads a STEP file
2. Backend renders the STEP file from multiple angles via the Build123d service
3. Screenshots fed to VLM to describe the geometry
4. Description fed to codegen LLM to produce Build123d code
5. Result rendered and shown alongside the original for comparison

This gives users an editable starting point they can refine via chat.

### Phase 2 — Dimension Extraction

Add structured data from the STEP file to improve accuracy:

- Bounding box dimensions
- Face count and types (planar, cylindrical, conical, etc.)
- Key measurements (hole diameters, wall thicknesses)
- Symmetry detection

Feed this alongside the visual data to ground the LLM's output in real measurements.

### Phase 3 — Feature Recognition

More sophisticated geometric analysis:

- Detect common manufacturing features (holes, pockets, slots, bosses)
- Identify likely construction sequence based on feature types
- Provide the LLM with a structured feature list rather than raw geometry

## Positioning

Frame this as **"STEP to editable starting point"** rather than "perfect reconstruction." For simple-to-medium parts (covering 70%+ of hobbyist/maker use cases), it could produce code that is 80–90% correct and immediately editable. The user then refines via chat — which plays directly to Chat3D's core strength.

## Open Questions

- Can the Build123d render service load arbitrary STEP files for screenshot generation, or does it need a new endpoint?
- What STEP parsing capabilities are available in the Build123d service's Python environment (OCP/cadquery already installed)?
- Should the feature target STEP specifically, or also support IGES, BREP, and other B-rep formats?
- How to handle large/complex STEP files that exceed LLM context limits when serialized?
