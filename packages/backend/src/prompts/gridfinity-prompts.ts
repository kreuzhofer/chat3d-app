/**
 * Gridfinity prompt section for the codegen system prompt.
 *
 * Covers the gridfinity_build123d library: bins, bases, baseplates,
 * compartments, and features. Follows the same pattern as bd_warehouse.
 */

export const CODEGEN_SECTION_GRIDFINITY = `## gridfinity_build123d — Gridfinity Storage System

The template pre-imports \`gridfinity_build123d\` classes. Use them to build Gridfinity-compatible storage bins, bases, and baseplates.

### Gridfinity Standard Dimensions

- **Grid unit:** 42mm x 42mm
- **Height unit:** 7mm (a "3U" bin = 21mm usable height)
- **Baseplate grid:** matches the 42mm grid exactly

### CRITICAL — Gridfinity objects are BasePartObjects

Unlike bd_warehouse (which requires \`fuse()\` or \`Compound\`), gridfinity objects like \`Bin\`, \`Base\`, and \`BasePlate\` are \`BasePartObject\` instances. **Assign them directly to \`root_part\`** — no \`add()\`, \`fuse()\`, or \`BuildPart()\` needed.

\`\`\`python
# CORRECT — assign directly:
root_part = Bin(...)

# WRONG — do NOT wrap in BuildPart or fuse:
with BuildPart() as part:
    add(Bin(...))  # ← NEVER do this
\`\`\`

### Bins

A Bin is built from a Base + height + optional compartments and lip.

\`\`\`python
# Simple bin: 2x1 grid, 3 height units, with stacking lip
root_part = Bin(
    base=BaseEqual(2, 1),
    height=3,
    lip=StackingLip(),
)
\`\`\`

Parameters:
- \`base\` — a \`Base\` or \`BaseEqual\` object defining the grid footprint
- \`height\` — height in grid units (7mm each)
- \`compartments\` — a \`Compartments\`, \`CompartmentsEqual\`, or single \`Compartment\`
- \`lip\` — \`StackingLip()\` to add the standard stacking lip

### Bases

Bases define the grid footprint and optional bottom features (magnets, screws).

\`\`\`python
# Rectangular base: 3x2 grid
base = BaseEqual(3, 2)

# Rectangular base with magnet holes in all four corners
base = BaseEqual(3, 2, features=[MagnetHole(BottomCorners())])

# L-shaped base using a boolean grid (True = occupied)
base = Base(grid=[[True, True, True],
                   [True, False, False]])
\`\`\`

### Baseplates

Baseplates are the trays that bins sit in.

\`\`\`python
# Simple frame baseplate: 4x3 grid
root_part = BasePlateEqual(4, 3, baseplate_block=BasePlateBlockFrame())

# Full baseplate (solid bottom)
root_part = BasePlateEqual(4, 3, baseplate_block=BasePlateBlockFull())

# Skeleton baseplate (lightweight, less material)
root_part = BasePlateEqual(4, 3, baseplate_block=BasePlateBlockSkeleton())

# Baseplate with magnet holes
root_part = BasePlateEqual(4, 3,
    baseplate_block=BasePlateBlockFull(features=[MagnetHole(BottomCorners())]),
)
\`\`\`

### Compartments

Compartments divide the interior of a bin into sections.

\`\`\`python
# Equal divisions: 3 columns x 2 rows, each with label + scoop
root_part = Bin(
    base=BaseEqual(3, 2),
    height=5,
    compartments=CompartmentsEqual(
        div_x=3, div_y=2,
        compartment_list=[Compartment(features=[Label(angle=36), Scoop()])],
    ),
    lip=StackingLip(),
)

# Custom grid layout: numbers define which compartment each cell belongs to
# (same number = merged cells)
root_part = Bin(
    base=BaseEqual(3, 2),
    height=4,
    compartments=Compartments(
        grid=[[1, 1, 2],
              [3, 3, 2]],
        compartment_list=[
            Compartment(features=[Label(angle=36)]),  # compartment 1 (top-left 2 cells)
            Compartment(features=[Scoop()]),           # compartment 2 (right column)
            Compartment(),                             # compartment 3 (bottom-left 2 cells)
        ],
    ),
    lip=StackingLip(),
)
\`\`\`

### Compartment Features

Applied to individual compartments:
- \`Label(angle=36)\` — angled label area on the front wall (default angle: 36 degrees)
- \`Scoop()\` — curved scoop at the bottom for easy part retrieval

### Object Features (Magnets, Screws, Weights)

Applied to \`Base(features=...)\` or \`BasePlateBlock*(features=...)\`:
- \`MagnetHole(location)\` — 6mm x 2.4mm magnet hole
- \`ScrewHole(location)\` — standard screw hole
- \`ScrewHoleCounterbore(location)\` — countersunk screw hole
- \`ScrewHoleCountersink(location)\` — countersink screw hole
- \`Weighted(location)\` — weight pocket

### Feature Locations

Specify where features are placed:
- \`BottomCorners()\` — all four corners of each grid unit
- \`TopCorners()\` — top corners
- \`BottomMiddle()\` — center bottom of each grid unit
- \`TopMiddle()\` — center top
- \`BottomSides(nr_x=1, nr_y=1)\` — along sides, with count per axis

### Complete Examples

**Tool organizer bin with compartments and scoops:**
\`\`\`python
root_part = Bin(
    base=BaseEqual(4, 1, features=[MagnetHole(BottomCorners())]),
    height=5,
    compartments=CompartmentsEqual(
        div_x=4, div_y=1,
        compartment_list=[Compartment(features=[Scoop()])],
    ),
    lip=StackingLip(),
)
\`\`\`

**Baseplate with magnet holes for a desk setup:**
\`\`\`python
root_part = BasePlateEqual(6, 4,
    baseplate_block=BasePlateBlockFull(features=[MagnetHole(BottomCorners())]),
)
\`\`\`

**MANDATORY**: When the prompt mentions gridfinity, storage bins, baseplates, modular storage, tool organizers, or compartment bins, you MUST use gridfinity_build123d classes. NEVER build gridfinity-compatible geometry manually — the library produces standard-compliant parts that fit together perfectly.`;
