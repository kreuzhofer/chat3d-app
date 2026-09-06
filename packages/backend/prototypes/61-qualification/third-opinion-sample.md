# Third opinion on a sample of the hard flips (arm 1 `62b4fa58` vs Sonnet `444483ec`), from the stored views

Triage for #57, per the standing decision on map #45: Fable 5.1 read the eight stored views of 11 examples and
decided 26 of the 59 hard-flip items. Daniel is the arbiter; every verdict below can be overturned by looking at the
same views. Verdict: **R** the reference (Sonnet) is right, **C** the candidate (qwen) is right, **N** not decidable from
the renders. "Resolved by" says what would have settled the item: the eight views as they are, a zoom, a view from
another angle, or nothing (a misreading of a plainly visible feature).

| example | item | qwen | Sonnet | verdict | what the views show | deciding view | resolved by |
|---|---|---|---|---|---|---|---|
| Gridfinity 5x1 `8d2ec9e8` | 1 five equal compartments | F | P | **R** | a long tray with four dividers, five compartments | ortho_45 | views as they are |
| | 2 stacking lip around the top perimeter | F | P | **C** | a thin wire loop floating around the middle 2x2, not a lip on the bin's rim | ortho_45, front | views as they are |
| | 3 footprint 5x1 | F | P | **C** | the base is a 2x2 block under the tray; the top view is a cross | top, bottom | views as they are |
| Feather RP2040 case `3069c73d` | 2 cavity faces upward | F | P | **R** | an open-top box, cavity plainly up | ortho_45 | none (qwen misread) |
| | 3 lid upside down beside it | F | P | **C** | there is no lid in the scene at all | all views | views as they are |
| | 5 circular hole on the lid | F | P | **C** | the hole is in the box floor; no lid exists | top, ortho_45 | views as they are |
| Nano Every case `676fd7b2` | 1 two separate parts side by side | F | P | **C** | box and slab touch along an edge, one connected body | top, front, bottom | views as they are |
| | 5 lid a flat slab placed next to the box | F | P | **R** | it is flat, rectangular and next to the box (touching) | ortho_45 | views as they are |
| | 6 visible gap between the parts | F | P | **C** | no gap in any view | top, front | views as they are |
| Pi 3 camera case `b6caba81` | 1 port cutouts on one long side | F | P | **R** | two notches in the back wall | ortho_45 | none (qwen misread) |
| | 2 four standoff posts inside | P | F | **C** | four posts at the corners (top view rings, bottom view holes, one post in 3D) | top, ortho_45_bottom | views as they are; Sonnet's zoom went to a low side view and saw nothing |
| | 6 lid upside down, platform facing down | F | P | **C** | the platform is on top of the lid, visible from above and in the left profile | top, left | views as they are |
| enclosure w/ 4 bosses `485cf1ba` | 2 exactly four bosses | P | F | **R** (medium) | one boss at the back-left; the far-right corner shows none; front corners occluded by the walls | ortho_45 | **another angle** (higher elevation or the opposite corner) |
| | 3 bosses at the four corners | P | F | **R** (medium) | same; from the top, a hole and a boss look alike | top | **another angle** |
| relay enclosure `f1f0a16c` | 1 open on top | F | P | **R** | an open box; qwen read the flat-shaded floor as a top face | ortho_45, top | none (qwen misread) |
| | 4 uniform wall thickness | F | P | **R** | rim of even width around the open top | top | none (qwen misread) |
| pivot hinge `4187966c` | 2 pin projecting down from the top plate | F | P | **R** | a dark cylinder between the plates, plain in the front view | front | none (qwen misread); its zoom went to the top view where the pin is hidden |
| | 5 pin narrower than the plate | F | P | **R** | obviously | front | none |
| strap hinge `4257c1e4` | 1 pointed arrowhead tips | F | P | **R** | both leaves taper to points | top | none (qwen misread) |
| | 5 chamfer visible on the leaf edges | P | F | **N** | a 1 mm chamfer on a 150 mm leaf is below what the renders show | — | nothing at this resolution; the gate's rule (not visible → fail) favours Sonnet |
| saloon hinge `4963f2df` | 2 central link connecting the two leaves | F | P | **C** | one leaf only; two tubes stand at a corner, nothing to link | top, ortho_45 | views as they are |
| | 3 two offset pin barrels visible | F | P | **R** | two offset bored cylinders are there | top | views as they are |
| concealed barrel hinge `92977023` | 3 pivot pin visible at the axis | F | P | **R** (low) | a disc inside the bore at the end face | top, ortho_45 | zoom |
| | 5 halves form a complete cylinder | F | P | **R** | a full cylinder with a seam line | ortho_45, front | none (qwen misread) |
| T-hinge `bd78cd78` | 3 strap leaf tapered | F | P | **R** | it tapers | top | none (qwen misread) |
| | 6 pin through all five knuckles | F | P | **C** | a pin stands up beside a single stub; there is no five-knuckle barrel | ortho_45 | views as they are |

## Tally

| direction | items | reference right (R) | candidate right (C) | N |
|---|---|---|---|---|
| qwen fails, Sonnet passes | 22 | 13 (qwen false fails) | 9 (Sonnet false passes) | 0 |
| qwen passes, Sonnet fails | 4 | 2 (qwen false passes) | 1 (Sonnet false fail) | 1 |

Extrapolated to the 59 hard flips (40 + 19): Sonnet false passes ≈ 16, qwen false passes ≈ 12, qwen false fails ≈ 24,
Sonnet false fails ≈ 6. The bar (ADR 0004): qwen's false passes ≤ Sonnet's — **holds, narrowly**; qwen's false fails
≤ 2× Sonnet's — **fails** (≈ 24 vs ≈ 12). The second half of the sample (4 items) is too small to lean on; the first is not.

## What the errors are made of

- **qwen's false fails are misreadings of large, plainly visible features** (an open box read as closed, a pin in a
  side view not seen, a tapered strap read as parallel, pointed tips read as flat, a cavity read as facing sideways).
  Not resolution, not a missing view: 10 of the 13 were decidable from the eight views as they are, and the feature
  fills a good part of the frame.
- **Sonnet's false passes are lenient readings of broken models**: it credits a lid that is not in the scene, a gap
  that is not there, a lip that is a floating wire, a link between leaves when there is one leaf. When a part is
  missing, every item about that part is passed. qwen, on those, is right.
- **Another angle would have settled 2 of 26** (the enclosure's occluded corner bosses). **A zoom, 1 of 26.** The
  follow-up's angle pick was wrong on 3 of the ~6 zooms in the sample (a low side view for interior posts, the top
  view for a pin hidden under a plate, a featureless rectangle for bosses).
- A **parts inventory** asked before the checklist (how many separate bodies, is the lid present, is the model one
  piece) would have caught 6 of Sonnet's 9 false passes at the root.
