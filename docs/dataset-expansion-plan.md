# Dataset Expansion Plan — 1K → 10K Training Examples

> **Status:** Planning. Last updated 2026-04-05.
> **Goal:** Expand the workbench from ~1,164 prompts / ~780 approved examples to ~3,500 unique prompts / ~10,000 examples.
> **Prerequisite:** Foundation fixes (100% generation, spec backfill, pending resolution) must complete first.

---

## Why New Categories, Not More Seeds

The roadmap includes "multiple seeds" as a scaling mechanism (3 seeds × 3,464 prompts ≈ 10K). But seeds alone produce *variations* of the same prompt — useful for robustness, not for teaching new capabilities. The model's complexity cliff (categories 11-12 drop from 8.5 avg to 5.4) reveals a **composition gap**: the model can do individual operations but struggles to combine them. New categories that teach technique composition and real-world application domains will produce a qualitatively better training set than 10× copies of the current prompts.

---

## Layer 1: Technique Mastery

These categories exist because the current library jumps from "learn operation X" (categories 1-6) to "build complex object Y" (categories 7-12) without teaching *how to combine operations*. Each category focuses on a single underrepresented technique with progressive difficulty.

### Sweeps & Helices (complexity 5-6, ~150 prompts)

Sweep is one of Build123d's most powerful operations and one of the most error-prone. The model needs dedicated practice constructing paths (BuildLine), defining cross-sections, and sweeping them correctly.

**Prompt spectrum:**
- Simple: "Sweep a circular profile along a quarter-circle arc" / "Create a helical spring with 10 turns"
- Medium: "A towel bar with curved mounting brackets" / "A spiral staircase handrail"
- Advanced: "A French horn-style tubing with expanding cross-section" / "A cable with varying diameter along its length"

**Key operations trained:** `sweep()`, `Helix`, `BuildLine`, `Spline`, `ThreePointArc`, path construction, `section()` for cross-sections

**Knowledge base needs:** More sweep examples with edge cases (self-intersecting paths, twist control, multi-section sweeps)

### Lofts & Transitions (complexity 5-6, ~150 prompts)

Loft creates geometry by blending between cross-sections — essential for organic shapes, adapters, and ergonomic forms. Currently almost zero dedicated training.

**Prompt spectrum:**
- Simple: "Loft from a square base to a circular top" / "A tapered hex-to-round adapter"
- Medium: "A vase that transitions from square at the bottom to round at the top" / "An airfoil wing section"
- Advanced: "A duct that transitions from rectangular to circular with a 90° bend" / "An ergonomic pen grip with finger contours"

**Key operations trained:** `loft()`, multi-section lofts, ruled lofts, loft with guide wires, cross-section alignment

**Knowledge base needs:** Loft failure patterns (twisted sections, self-intersection), guide wire usage examples

### Shell & Hollow Bodies (complexity 5-6, ~100 prompts)

Almost every practical 3D-printed object is hollow. Shell/offset is critical but has no dedicated training — it's scattered across enclosure prompts where it fails alongside other complexity.

**Prompt spectrum:**
- Simple: "Hollow out a box with 2mm walls, open top" / "Shell a cylinder, removing both ends"
- Medium: "A cup with a handle — shell the body but keep the handle solid" / "A nested box with inner and outer shells"
- Advanced: "A double-walled tumbler with air gap" / "A housing with variable wall thickness (thicker at mounting points)"

**Key operations trained:** `offset()`, `shell()`, selective face removal, wall thickness control, multi-body shell interactions

**Knowledge base needs:** Shell failure modes (thin walls, sharp corners causing self-intersection), face selection for open sides

### Secondary Features — Sketch-on-Face (complexity 6-7, ~150 prompts)

**This is the single highest-leverage new category.** Real parts have mounting holes, pockets, bosses, ribs, gussets, and counterbores. The model rarely adds these correctly because there's no focused training on face selection + sketch placement.

**Prompt spectrum:**
- Simple: "A box with four M3 mounting holes on the bottom face" / "A cylinder with a keyway slot"
- Medium: "A bracket with counterbored holes on one face and a ribbed underside" / "An enclosure with ventilation slots on the side walls"
- Advanced: "A motor mount with 4 mounting holes, a central bore with press-fit tolerance, and reinforcement ribs connecting the bore to the base" / "A PCB standoff plate with mixed hole sizes at specific coordinates"

**Key operations trained:** `Plane` face selection, sketching on existing geometry, `CounterBoreHole`, `CounterSinkHole`, boss/pocket creation, rib/gusset patterns

**Knowledge base needs:** Face selection recipes (top face of a filleted box, inner face of a cylinder), coordinate placement on faces

### Text, Engraving & Surface Detail (complexity 5-6, ~100 prompts)

Nearly every manufactured part has labels, logos, or surface texture. Build123d's `Text` primitive is powerful but quirky (font handling, projection onto curved surfaces). Almost zero training data exists.

**Prompt spectrum:**
- Simple: "A nameplate with embossed text 'HELLO'" / "A box with a debossed serial number on the lid"
- Medium: "A cylindrical bottle with text wrapped around the surface" / "A sign with multi-line raised lettering"
- Advanced: "A control panel face with engraved labels next to each button cutout" / "A coin with embossed text on both faces and a patterned rim"

**Key operations trained:** `Text()`, `extrude()` with `Mode.ADD`/`Mode.SUBTRACT` for emboss/deboss, text on curved surfaces, font sizing, `project()` onto faces

**Knowledge base needs:** Text font compatibility, projection onto curved surfaces, multi-line text layout

### BuildLine & Complex Profiles (complexity 4-5, ~100 prompts)

BuildLine is the foundation for sweeps, lofts, and custom sketch outlines. Training it separately ensures the model can construct reliable paths before using them in 3D operations.

**Prompt spectrum:**
- Simple: "A rounded rectangle profile using arcs and lines" / "A star outline with 5 points"
- Medium: "A custom gasket profile with specific corner radii" / "An I-beam cross-section"
- Advanced: "A spline-based airfoil profile from coordinate data" / "A cam profile with tangent-continuous transitions between dwell and rise sections"

**Key operations trained:** `BuildLine`, `Line`, `ThreePointArc`, `Spline`, `Polyline`, `TangentArc`, `EllipticalArc`, wire closure, tangent continuity

**Knowledge base needs:** Tangent continuity rules, common profile patterns, debugging open wires

---

## Layer 2: Application Domains

Real-world use cases that combine multiple techniques. Each maps to a high-demand 3D printing category.

### Brackets, Mounts & Adapters (complexity 6-7, ~200 prompts)

The #1 use case for desktop 3D printing. Every makerspace, workshop, and home has custom mounting needs. These objects are moderate complexity but exercise a wide range of operations.

**Sub-domains (40 prompts each):**
- Wall mounts (TV, monitor, shelf, tool holder)
- Sensor/camera brackets (GoPro, Pi camera, proximity sensors)
- Phone/tablet holders (desk stands, car mounts, bike mounts)
- Adapter plates (converting between hole patterns, VESA adapters)
- Structural brackets (L-brackets, corner braces, shelf supports with gussets)

**Operations exercised:** Sketch-on-face, fillets, counterbored holes, arrays, booleans, ribs/gussets

### Snap-Fits, Joints & Jointery (complexity 7-8, ~150 prompts)

Teaches the model how parts connect — critical for multi-part designs and practical prints. Requires dimensional tolerance awareness.

**Sub-domains:**
- Cantilever snap-fits (hooks, clips, battery covers) — 30 prompts
- Press-fit joints (bearing seats, dowel holes, shaft collars) — 25 prompts
- Dovetail & slide joints (drawer slides, rail systems) — 25 prompts
- Living hinges (thin-section flex joints for one-piece designs) — 20 prompts
- Threaded connections (screw threads, bottle caps, jar lids) — 25 prompts
- Pin & clip joints (clevis pins, cotter pins, retaining clips) — 25 prompts

**Operations exercised:** Precise dimensioning, tolerances (0.1-0.3mm clearances), threads, thin-wall geometry, sweep for living hinges

**Knowledge base needs:** 3D printing tolerance guidelines per material, snap-fit design rules (overhang angle, deflection calculation)

### Pipe Fittings & Fluid Components (complexity 7-8, ~150 prompts)

Rich domain that exercises sweeps, revolutions, booleans, and threading simultaneously. Many standard dimensions to learn.

**Sub-domains:**
- Elbows and bends (45°, 90°, custom angles) — 25 prompts
- Tees and crosses (equal, reducing) — 25 prompts
- Reducers and adapters (concentric, eccentric) — 25 prompts
- Flanges (slip-on, weld-neck, blind) — 25 prompts
- Nozzles and spouts (spray patterns, flow directors) — 25 prompts
- Manifolds and distributors (multi-port, custom routing) — 25 prompts

**Operations exercised:** Revolve, sweep along path, boolean subtract for internal channels, threading, arrays for bolt patterns

**Knowledge base needs:** Standard pipe dimensions (NPT, BSP), wall thickness rules, flow-path geometry

### Containers & Custom Organizers (complexity 6-7, ~150 prompts)

Non-Gridfinity containers — custom designs where the user specifies exact dimensions and compartment layouts. Distinct from Generic Enclosures (which focus on electronics housings).

**Sub-domains:**
- Desk organizers (pen holders, card trays, phone stands) — 30 prompts
- Tool storage (bit holders, wrench racks, socket trays) — 30 prompts
- Parts bins and trays (divided compartments, stackable) — 30 prompts
- Kitchen/home (spice racks, utensil holders, drawer dividers) — 30 prompts
- Hobby storage (paint racks, miniature cases, filament spool holders) — 30 prompts

**Operations exercised:** Shell, arrays for compartments, fillets for printability, snap/slide-fit lids, stacking features

### Furniture Hardware & Home (complexity 6-7, ~150 prompts)

High user demand, moderate complexity, satisfying results. Knobs and handles are one of the most popular 3D print categories.

**Sub-domains:**
- Cabinet knobs and pulls (round, bar, decorative) — 30 prompts
- Hooks and hangers (wall hooks, over-door, S-hooks, towel bars) — 30 prompts
- Shelf hardware (brackets, clips, supports, pegs) — 25 prompts
- Drawer components (pulls, dividers, slides, stops) — 25 prompts
- Cable management (desk clips, wall channels, grommets, strain reliefs) — 20 prompts
- Decorative/functional (picture frames, vase shapes, lampshade rings) — 20 prompts

**Operations exercised:** Revolve (knobs), sweep (hooks), fillets, ergonomic curves, loft for organic shapes

### Structural Profiles & Beams (complexity 5-6, ~100 prompts)

Cross-section profiles extruded or swept along lengths. Aligns with the planned `bd_beams_and_bars` library integration.

**Sub-domains:**
- Standard profiles (I-beam, C-channel, T-section, angle, Z-section) — 25 prompts
- T-slot and V-slot extrusion profiles (20xx, 30xx, 40xx series) — 25 prompts
- Custom profiles (U-channels, hat sections, corrugated panels) — 25 prompts
- Structural connectors (gusset plates, end caps, corner brackets for profiles) — 25 prompts

**Operations exercised:** BuildLine for profiles, extrude, sweep along curved paths, boolean for slots/holes, arrays for bolt patterns

### Gears & Power Transmission (complexity 8-9, ~100 prompts)

Advanced mechanical components requiring parametric math. Aligns with the planned `py_gearworks` library integration.

**Sub-domains:**
- Spur gears (varied module, tooth count, bore) — 20 prompts
- Helical gears (helix angle, hand) — 15 prompts
- Bevel gears (shaft angle, cone angle) — 15 prompts
- Worm gear sets (worm + wheel) — 10 prompts
- Pulleys and timing belts (GT2, HTD profiles) — 15 prompts
- Sprockets and chains — 10 prompts
- Cams and followers (disc, barrel, face) — 15 prompts

**Operations exercised:** Parametric math, involute curves, sweep for helical teeth, revolve, boolean, arrays

**Prerequisite:** `py_gearworks` library integration for helical/bevel/worm types

### Robotics & Sensor Mounts (complexity 7-8, ~100 prompts)

Combines enclosure design with bracket design and fastener integration. Popular in maker/education communities.

**Sub-domains:**
- Servo mounts (standard sizes: SG90, MG996R, Dynamixel) — 20 prompts
- Sensor housings (ultrasonic, LiDAR, IMU, camera modules) — 20 prompts
- Wheel hubs and casters (shaft coupling, bearing seats) — 20 prompts
- Chassis plates and frames (mounting patterns, standoffs, cable routing) — 20 prompts
- Actuator mounts (linear actuators, stepper brackets, belt tensioners) — 20 prompts

**Operations exercised:** Sketch-on-face for mounting holes, counterbores, arrays, fillets, shell for housings, press-fit tolerances

**Knowledge base needs:** Standard servo dimensions, common sensor module footprints, bearing specifications

---

## Layer 3: Intelligence Amplifiers

These aren't object categories — they're training signal types that improve the model's *reasoning* across all categories.

### Compound Multi-Technique Objects (complexity 7-9, ~200 prompts)

Each prompt explicitly requires 4-6 different techniques composed in a specific sequence. The model must learn to *plan* before coding.

**Structure:** Every prompt names the techniques required, e.g., "Create a cylindrical container (revolve) with a threaded lid (sweep), internal dividing walls (sketch-on-face + extrude), a living hinge connecting lid to body (thin-section extrude), and an embossed label on the outside (text + boolean)."

**Difficulty tiers:**
- 4-technique (50 prompts): Combine operations from 4 distinct categories
- 5-technique (75 prompts): Add dimensioning or tolerance constraints
- 6-technique (75 prompts): Full complexity — multiple bodies, assembly references, parametric relationships

**Why this matters:** The model currently treats each operation independently. These prompts force it to reason about operation *ordering* (you can't fillet edges that don't exist yet) and *interaction* (a shell operation changes the faces available for sketch-on-face).

### Dimensional & Tolerance-Aware Design (complexity 7-8, ~100 prompts)

Objects where numerical precision matters — clearances, interference fits, and mating surfaces.

**Prompt types:**
- Press-fit: "A bearing holder for a 608ZZ bearing (22mm OD, 0.05mm interference fit)" — 25 prompts
- Sliding fit: "A box with a sliding lid — 0.2mm clearance on all sides" — 25 prompts
- Nesting/stacking: "Stackable bins where each bin sits 2mm inside the one below" — 25 prompts
- Mating parts: "A two-piece enclosure with alignment pins and 0.15mm gap" — 25 prompts

**Why this matters:** The model often produces geometry that looks right but doesn't *fit*. These prompts teach it that dimensions are constraints, not suggestions.

### Modification & Iteration Prompts (complexity 6-8, ~150 prompts)

Simulates the conversational use case: given an existing shape description, modify it. This is how users actually interact with Chat3D.

**Prompt types:**
- Add feature: "A box. Now add four mounting holes at the corners." — 40 prompts
- Remove/modify: "A gear with 20 teeth. Change it to 30 teeth and add a keyway." — 40 prompts
- Combine: "Attach part A (a bracket) to part B (a base plate) with 15mm offset." — 35 prompts
- Parametric variation: "A shelf bracket. Now make a version that's 50% wider with the same proportions." — 35 prompts

**Why this matters:** Fine-tuning on single-shot prompts doesn't teach the model to modify existing geometry. These multi-step prompts teach *incremental design thinking*, which is the core Chat3D interaction pattern.

---

## Sequencing & Dependencies

```
Foundation fixes (in progress)
  ↓
Wave 1: Layer 1 — Technique Mastery (750 prompts)
  Priority: Secondary Features → Sweeps → Shell → Lofts → BuildLine → Text
  Dependencies: None (pure Build123d operations)
  ↓
Wave 2: Layer 2a — High-demand domains (500 prompts)
  Categories: Brackets, Containers, Furniture Hardware
  Dependencies: Wave 1 (these combine techniques taught in Layer 1)
  ↓
Wave 3: Layer 2b — Complex domains (600 prompts)
  Categories: Snap-Fits, Pipe Fittings, Gears, Robotics, Structural Profiles
  Dependencies: Wave 1 + library integrations (py_gearworks, bd_beams_and_bars)
  ↓
Wave 4: Layer 3 — Intelligence Amplifiers (450 prompts)
  Categories: Compound Objects, Tolerances, Modification Prompts
  Dependencies: Waves 1-3 (compound prompts reference the full technique vocabulary)
  ↓
Wave 5: Multiple Seeds
  Re-run all ~3,464 prompts with 2 additional seeds → ~10,400 total examples
  Dependencies: All previous waves complete with acceptable approval rates
```

---

## Knowledge Base Expansion Needs

New categories will require knowledge base additions to achieve high approval rates:

| Category | Knowledge Needed |
|----------|-----------------|
| Sweeps & Helices | Sweep edge cases, twist control, self-intersection avoidance |
| Lofts & Transitions | Guide wire usage, section alignment, failure patterns |
| Shell & Hollow Bodies | Face selection for open sides, thin-wall minimum thickness |
| Secondary Features | Face selection recipes, coordinate placement on faces |
| Text & Engraving | Font compatibility, curved surface projection |
| Snap-Fits & Jointery | 3D printing tolerance tables, material-specific clearances, snap-fit design rules |
| Pipe Fittings | Standard pipe dimensions (NPT, BSP), wall thickness standards |
| Gears | Involute math, gear meshing geometry (covered by py_gearworks docs) |
| Robotics | Standard servo/sensor dimensions, bearing specs |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Total unique prompts | ≥ 3,400 |
| Total approved examples | ≥ 10,000 (with seeds) |
| Render success rate (all categories) | ≥ 85% |
| Auto-approval rate (new categories) | ≥ 70% |
| Avg eval score (Layer 1 categories) | ≥ 8.0 |
| Avg eval score (Layer 2 categories) | ≥ 7.5 |
| Avg eval score (Layer 3 categories) | ≥ 7.0 |
| Spec coverage (all prompts) | 100% spec_interpretation + construction_spec |
