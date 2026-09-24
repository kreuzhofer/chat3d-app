# Disagreements: chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) vs Claude Sonnet 4.6 (Anthropic API, thinking off)

Instrument: `production@4892d8d1b160`. 66 disagreeing items on 44 examples (66 hard pass/fail flips, 0 with one side uncertain; 0 where chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) answered differently from the first arm).

Verdict column: `R` the reference is right, `C` the candidate is right, `N` neither or the item is unanswerable, with a note if needed. The candidate's confirmed false passes must not exceed the reference's; its confirmed false fails must not exceed twice the reference's (ADR 0004).

## 1. Hinges — example `086dc6b0-d9b4-4d79-8dfe-0eec4c397845`

> A butterfly hinge with two symmetrical wing-shaped leaves, each 70mm tall x 40mm wide x 2mm thick. The leaf profile is a stylized butterfly wing with a concave waist narrowing to 15mm near the barrel. Three 3.5mm mounting holes per leaf. Five barrel knuckles on a 3mm pin.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Does each leaf show exactly 3 circular mounting holes? | **fail** — Bottom view and 45° up view: only 2 holes are visible per leaf (4 total), positioned symmetrically near the top and bottom lobes; no third hole near the waist center is visible on either leaf in any view | **pass** — Bottom view: each leaf shows three circular holes (two near the outer lobes, one near the waist); the 45° up view confirms three holes per leaf. | same |  |

## 2. Gridfinity Storage — example `230a3336-9aa2-451e-873d-73c0e8403c85`

> Create a 1x1 Gridfinity bin, 5 height units, no compartments, no lip — a simple deep cup bin

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Is the top edge open with no lip or rim overhang? | **fail** — Top view and 45° down view: the top surface appears completely solid/flat with no open cavity visible; a correct open bin should show the interior cavity walls and floor from above | **pass** — Top view and 45° down view show a flat open rim with no overhanging lip or tab; the top edge is flush with the outer wall. | same |  |

## 3. Hinges — example `30f7cab2-dd52-4ef3-ae02-65dde4b62327`

> A long strap hinge: two tapered leaves, each 200mm long tapering from 40mm wide at the barrel end to 20mm wide at the tip, 2.5mm thick. Five 4mm mounting holes per leaf. Barrel with five knuckles and a 3.5mm pin.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Do both leaves taper visibly from a wider barrel end to a narrower tip? | **fail** — Top and bottom views show the combined assembly tapering from a wider center outward to narrow tips on both sides — this suggests the widest point is at the center (barrel junction) which is correct for the barrel end being widest, but the taper appears symmetric like a lens/diamond shape rather than two separate trapezoidal leaves. The 45° down view shows nearly uniform width along most of the length with only slight taper, making the taper less convincing than expected. | **pass** — Top and bottom views show each leaf widest at the barrel end and narrowing linearly toward the tip; the 45° views confirm the taper on both leaves. | same |  |
| 2 | Are there exactly five knuckles on the barrel, visibly interleaved between the two leaves? | **fail** — 45° down view and left/right views show only a tiny cylindrical stub at the barrel center — no distinct five knuckle segments are visible. The knuckles should form a 30mm tall barrel assembly but no such structure is apparent in any view. | **pass** — Front/back views show a segmented barrel with five distinct knuckle bands; the 45° down view shows the knuckles interleaved between the two leaves. | same |  |
| 3 | Does the pin pass through all five knuckles along the barrel axis? | **fail** — [2x zoom] 45° down view: At the barrel end (center of the assembly), only a single small cylindrical pin stub is visible protruding above the leaf surface with no knuckle cylinders surrounding it — the five interleaved knuckles are entirely absent, so the pin cannot be passing through all five knuckles. | **pass** — Front view shows a pin protruding above the barrel; the 45° down view shows the pin running the full length of the knuckle stack. | same |  |

## 4. PCB Cases — example `3d5ac379-03bd-48e6-a657-145308b3b02a`

> A Raspberry Pi 4 compute case: rectangular box 93mm x 64mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 93mm x 64mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 4 | Is the lid a flat rectangular plate sitting beside the box (not on top of it)? | **pass** — 45° down view and top view: A flat rectangular plate is clearly visible beside the box with a gap between them, not placed on top of the box. | **fail** — 45° down view: the lid is a flat plate but is positioned far from the case, not beside it with a 20mm gap. | same |  |
| 5 | Are both parts resting on the same flat surface with a visible gap between them? | **pass** — Front view and 45° down view: Both parts appear at the same ground level with a visible gap separating them. | **fail** — 45° down view: the lid and case appear to be at different heights or not aligned on the same ground plane; the gap is much larger than 20mm. | same |  |

## 5. Hinges — example `4257c1e4-da50-44e6-b7c6-279a2017eabb`

> A decorative strap hinge with two 150mm-long leaves featuring a pointed arrowhead tip. Each leaf is 30mm wide, 2mm thick, with four 4mm mounting holes. The barrel has five knuckles on a 3mm pin. Leaf edges have a 1mm chamfer.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Does each leaf have a pointed arrowhead tip at the free end? | **pass** — Top view and both isometric views clearly show both leaves tapering symmetrically to a sharp pointed tip at each free end, forming the classic arrowhead/spear profile. | **fail** — Top and bottom views show each leaf tapering gradually to a point along its full length rather than having a straight rectangular body with a distinct arrowhead tip at the end. | same |  |
| 2 | Are there exactly five knuckles on the barrel assembly? | **fail** — [2x zoom] Top view: The barrel assembly at the center of the hinge shows only approximately 2-3 visible knuckle segments in the interleaved barrel area, not five distinct knuckles; the barrel appears very small and compressed, and counting individual knuckles reveals fewer than five clearly defined cylindrical segments along the pin axis. | **pass** — Top and bottom views show five small knuckle segments clustered at the center of the hinge, consistent with a 5-knuckle barrel. | same |  |
| 5 | Is a chamfer visible along the leaf edges? | **fail** — [2x zoom] 45° down view: The leaf edges appear as sharp, square corners with no visible angled chamfer face along the perimeter edges of either leaf; the edge transitions show no distinct chamfer bevel strip between the top face and the side faces. | **pass** — [2x zoom] 45° down view: a thin lighter band runs along the perimeter of the leaf face, indicating a 1mm chamfer on the top face edges. | same |  |

## 6. Gridfinity Storage — example `427d888e-61ec-4ce5-b46e-85457cd8a4a7`

> Create a 4x4 Gridfinity baseplate using frame-style blocks

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Bottom face is a single continuous flat plane at Z = 0 with no protrusions or recesses below datum | **fail** — 45° up view and bottom view: the bottom face shows fully open cell apertures — the cells appear to be complete through-cuts with no solid bottom plane; the bottom view shows open squares arranged in a 4×4 grid with no continuous flat surface closing the bottom, indicating the pockets go all the way through with no Z=0 datum plane | **pass** — Bottom view shows a flat, uniform underside with the same 4x4 lattice pattern and no visible bumps, recesses, or magnet pockets below the plane; the 45° up view confirms a flat bottom face with no protrusions. | same |  |

## 7. Generic Enclosures — example `485cf1ba-1263-4b11-914c-f6e2b44431a7`

> A rectangular electronics enclosure: 120mm × 80mm × 50mm, 3mm walls, open top, with four M3 through-hole corner boss standoffs (5mm diameter, 8mm tall) inside

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Are there exactly 4 cylindrical standoff bosses inside the enclosure? | **fail** — [2x zoom] Top view: shows 4 small circular features at the four corners of the interior, but the 45° down view shows only 1 cylindrical standoff boss visible inside the enclosure (near the back-left corner), indicating the model has only 1 boss rather than 4. | **pass** — Top view shows four circular bosses at the corners; 45° down view shows one boss with a through-hole, others occluded by walls. | same |  |

## 8. Hinges — example `4890e064-0c18-4676-a4c1-dd84633264ce`

> A concealed barrel hinge: two 12mm-diameter cylindrical halves, each 40mm long, connected by an internal 4mm pivot pin. Each half has a 10mm-long flat mounting tab extending radially, 15mm wide x 2mm thick, with a single 4mm screw hole.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is a pivot pin visible at the axis connecting the two halves? | **pass** — Front, back, and 45° down views: a cylindrical pin is clearly visible running vertically at the center of the assembly, connecting the two halves | **fail** — A segmented rod with gaps and a separate vertical cylinder is visible, not a single solid coaxial pivot pin. | same |  |

## 9. Hinges — example `4963f2df-259c-4f4d-ac0c-8b7706a14a2c`

> A double-action saloon-door hinge that allows 180-degree swing in both directions: two 90mm x 45mm x 2.5mm leaves connected by a central barrel assembly with two independent pivot axes offset by 8mm. Each pivot has a 3.5mm pin. The assembly allows the leaves to swing past center in either direction. Four 4mm holes per leaf.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Is there a central barrel/link assembly connecting the two leaves between their inner edges? | **pass** — [2x zoom] 45° down view: shows two cylindrical barrels with through-bores standing vertically, connected by a flat rectangular link plate between them, positioned at the inner edge of the single visible leaf — confirming the central barrel/link assembly is present connecting the leaves at their inner edges. | **fail** — Front/back views show a thin horizontal bar and a small circular boss, but no central link plate bridging two barrels between two leaves. | same |  |
| 3 | Are there two distinct cylindrical pin barrels visible in the central assembly, visibly offset from each other? | **pass** — Top view and 45° down view: Two separate cylindrical barrels with visible through-bores (hollow circles) are clearly shown side by side at the inner edge of the leaf, offset from each other. | **fail** — Top/bottom views show two small offset circles at one corner and 45° views show two tall vertical posts, but these are corner posts, not full-height offset barrels spanning the leaf. | same |  |
| 5 | Do the two pivot axes appear parallel and separated (offset) rather than coincident? | **pass** — Top view: The two barrel cylinders are clearly shown as separate parallel circles offset horizontally from each other, confirming two distinct parallel pivot axes. | **fail** — The two visible circular features at the corner are offset, but they belong to corner posts, not to a proper double-axis barrel assembly; the overall hinge structure is not present. | same |  |

## 10. PCB Cases — example `4d855bd1-9c11-4057-8e58-0424c7010261`

> A Jetson Nano case: rectangular box 111mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-C cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 111mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Is the case an open-top rectangular box with visibly thin walls? | **pass** — 45° up view: clearly shows an open-top rectangular box with thin walls on all four sides and a floor; the interior cavity is visible from above | **fail** — 45° down and 45° up views show a solid rectangular block with no visible interior cavity or thin walls; the top face appears closed with cutouts on it rather than open. | same |  |
| 2 | Are there exactly three cutout openings on one short wall of the case? | **pass** — [2x zoom] 45° up view: The short wall of the case clearly shows three distinct rectangular cutout openings of varying widths and heights arranged side by side across the wall face. | **fail** — Top view shows three small notches along the top edge of the case, and the 45° views show cutouts on the top face rather than on a short side wall; the front/back views show only two dark rectangles on the face, not three cutouts on a short wall. | same |  |

## 11. PCB Cases — example `4e3686ec-b26f-40d3-a574-f0d3afba1f8b`

> A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Are there exactly three cutouts visible on one short wall of the box? | **fail** — 45° down view and left view: cutouts are visible on the short wall, but only one clearly defined rectangular opening is distinguishable; a second smaller feature may be present but three distinct cutouts (USB, Ethernet, HDMI) cannot be confirmed | **pass** — 45° down view: three rectangular cutouts of differing sizes are visible on the short wall facing the camera; left view: three cutout shapes are visible on the short wall face. | same |  |
| 3 | Are there four cylindrical standoff posts visible at the interior corners of the box? | **fail** — 45° down view: only one small cylindrical standoff post is visible near one interior corner; the other three corner positions show no standoff posts; top view shows faint circular hints at corners but only 2 are marginally visible | **pass** — top view: four small circular posts with central holes are visible at the four interior corners of the case; 45° down view: at least two posts are visible inside the case. | same |  |

## 12. PCB Cases — example `505855b7-b707-4946-b6bc-5dcc0acebfa5`

> A NVIDIA Jetson case: rectangular box 108mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), mini-HDMI cutout (12mm x 5mm). Flat lid 108mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 4 | Are there exactly four standoff posts visible inside the case when viewed from above? | **fail** — [2x zoom] Top view (case interior, lower rectangle): Four small circular standoff posts are visible at the corners of the case interior, but the 45° down view shows only one standoff cylinder clearly visible near the back-left corner area, and the other three are not distinctly rendered — the top view shows what appear to be four faint circular marks at the four corners, but the 45° down view confirms only one standoff post is clearly present/rendered, suggesting fewer than four standoffs are actually modeled. | **pass** — Top view: shows four small circular posts at the corners of the case interior; 45° down view: shows at least one standoff post inside the case. | same |  |

## 13. Gridfinity Storage — example `56a2ef96-5e2c-4fa3-944c-81eab8f81c33`

> Create a 3x1 Gridfinity base with screw holes and magnet holes in the bottom corners

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 4 | Does the top surface have a raised lip/profile around each of the 3 cell positions? | **fail** — 45° down view and top view: the top surface shows shallow grid dividers between cells but no clearly raised stepped Gridfinity lip profile with vertical walls and 45° chamfer; the surface appears largely flat | **pass** — Top view shows a raised perimeter wall with two internal dividers creating three cell pockets, each with a stepped lip profile visible around the cell openings. | same |  |

## 14. Hinges — example `5982f19a-a589-4352-8a47-e5a221cc1516`

> A concealed barrel hinge: two 12mm-diameter cylindrical halves, each 40mm long, connected by an internal 4mm pivot pin. Each half has a 10mm-long flat mounting tab extending radially, 15mm wide x 2mm thick, with a single 4mm screw hole.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is a pivot pin visible at the axis connecting the two halves? | **pass** — Front/back views: a vertical cylindrical rod is clearly visible at the center of the assembly; 45° views also show cylindrical pin segments at the hinge axis | **fail** — 45° down/up views show a segmented pin with multiple gaps and a separate vertical cylinder, not a single continuous 40mm pin coaxial with the barrel bores. | same |  |

## 15. Hinges — example `5b191911-1775-43ee-8571-808ca02c2bca`

> A decorative butt hinge with two 90mm x 50mm x 2.5mm leaves and five interlocking barrel knuckles on a 3.5mm pin. Each leaf end of the barrel is capped with a 7mm-diameter ball finial. Four 4mm countersunk holes per leaf.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is there a ball finial at each end of the barrel (top and bottom)? | **pass** — Left/right views clearly show two ball finials at both ends of the horizontal barrel rod; 45° down and up views also confirm two spherical finials at opposite ends of the barrel axis | **fail** — Top/bottom views show a ball at each end of the pin, but the 45° views show the balls detached from the barrel ends rather than seated flush against the outermost knuckles. | same |  |

## 16. PCB Cases — example `676fd7b2-2c35-4f1c-8302-13254f8b91ff`

> A Arduino Nano Every case: rectangular box 53mm x 26mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: microSD slot (13mm x 3mm). Flat lid 53mm x 26mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is there a rectangular cutout on one short side of the box? | **pass** — Left view: a dark rectangular slot is visible near the bottom of the short side wall of the box, consistent with a microSD cutout | **fail** — Left and right views show the short sides of the box; no rectangular cutout is visible on either short side. | same |  |
| 6 | Is there a visible gap between the two parts? | **pass** — 45° down view and top view: a clear gap is visible between the right wall of the box and the left edge of the lid | **fail** — Front, back, and 45° down views show the lid touching or nearly touching the box, with no clear gap between them. | same |  |

## 17. PCB Cases — example `7ec78504-9b96-46b3-8573-fcc0441d05b9`

> A Jetson Nano case: rectangular box 111mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-C cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 111mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Are there exactly three cutout openings on one short wall of the case? | **fail** — 45° down view: the short wall shows rectangular cutouts but only two distinct openings are clearly visible, not three separate cutouts as specified | **pass** — 45° down view: three rectangular cutouts are visible on the short wall (left side of the case), matching the requested USB-C, Ethernet, and HDMI openings. | same |  |
| 3 | Are there four standoff posts visible inside the case at the corners? | **fail** — 45° down view and top view: only one standoff post is clearly visible near the port wall corner; the other three corner standoffs are not visible despite the open top providing a clear view of the interior | **pass** — top view: four small circular posts are visible at the four corners of the case interior; 45° down view shows at least one post clearly. | same |  |

## 18. Hinges — example `8811fab8-362e-4518-958d-65d67fb05e09`

> A 200mm segment of a continuous piano hinge: two 25mm-wide leaves, 1mm thick, joined by interlocking knuckles along the full 200mm length (knuckle pitch 10mm). A 2mm-diameter continuous pin. Mounting holes every 25mm, 3mm diameter.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is there a continuous pin visible running through all the knuckles? | **pass** — 45° down and 45° up views: a thin cylindrical rod is visible running along the hinge axis, protruding beyond the hinge body at both ends; top and bottom views also confirm a thin line element along the central axis | **fail** — 45° down and 45° up views show only a short pin segment near the center, not a continuous pin spanning the full length. | same |  |

## 19. Gridfinity Storage — example `8d2ec9e8-3e54-46ff-9075-a34a711d204c`

> Create a 5x1 Gridfinity bin, 2 height units (shallow), divided into 5 equal compartments with labels, with a stacking lip — a shallow tray for SD cards or small electronics

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Does the bin have exactly 5 equal compartments separated by divider walls? | **pass** — 45° down view: clearly shows 4 internal divider walls creating 5 equal-width compartments along the long axis of the bin | **fail** — Top view and 45° down view show four square compartments in a 2x2 arrangement, not five compartments in a row. | same |  |
| 2 | Is there a raised stacking lip around the top perimeter of the bin? | **pass** — 45° down view and left/right views: a raised rectangular perimeter ridge is visible around the top edge of the bin, consistent with a stacking lip | **fail** — Top view and 45° down view show only a thin rectangular outline floating above the bin, not a solid raised perimeter ridge. | same |  |
| 3 | Is the footprint 5 units wide and 1 unit deep (roughly 5× longer than it is wide)? | **pass** — Front view and top view: the bin is approximately 5× longer than it is wide, consistent with a 5×1 Gridfinity footprint | **fail** — Top view shows a roughly square 2x2 footprint, not an elongated 5x1 rectangle. | same |  |
| 4 | Is the bin visibly shallow (low height relative to its footprint)? | **pass** — Front view and left view: the bin height is very small relative to its length and width, confirming a shallow 2-unit-height profile | **fail** — Front and left views show a bin whose height is a large fraction of its footprint, not a shallow 2-height-unit tray. | same |  |
| 5 | Does each compartment have a label ledge or angled front cutout? | **pass** — Front view shows diagonal angled lines along the front face indicating angled label ledge cutouts; 45° down view confirms angled features on the front interior face of each compartment | **fail** — Front view shows no recessed label shelves on the front face; the 45° down view shows only small angled tabs on the dividers. | same |  |

## 20. PCB Cases — example `91288207-c4b1-446d-9fb1-5720fa0bcba5`

> A NVIDIA Jetson case: rectangular box 108mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), mini-HDMI cutout (12mm x 5mm). Flat lid 108mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Is the case a rectangular open-top box (open side facing upward)? | **pass** — 45° up view: clearly shows an open-top rectangular box with four walls and a floor, open face pointing upward | **fail** — Top view shows a solid filled rectangle with no cavity; 45° up view shows a solid block with no open top or interior walls visible | same |  |
| 2 | Is the lid a separate flat rectangular piece placed upside-down next to the case? | **pass** — 45° down and 45° up views: a flat rectangular plate is present separately from the case, placed to one side with a visible gap; it appears as a thin flat slab consistent with an inverted lid | **fail** — Top view shows the lid as a separate flat rectangle but positioned far from the case with a large gap; 45° down view shows the lid separated by a wide distance rather than adjacent with a 20mm gap | same |  |

## 21. Gridfinity Storage — example `9e794b0a-569a-46b7-bb80-90be26da0740`

> Create a 3x3 Gridfinity baseplate using skeleton blocks for minimal material usage

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Does each cell have a raised lip/chamfered entry profile for Gridfinity bin compatibility? | **fail** — 45° down view and top view show the cell openings as simple flat-edged rectangular holes with no visible stepped lip, chamfer, or fillet profile around the inner perimeter of each cell; the side views (front, back, left, right) show only a thin flat bar with no profile variation visible. | **pass** — Top view shows a raised rim ring around each cell opening; the 45° down view shows the rim standing above the base floor with a chamfered inner edge. | same |  |

## 22. PCB Cases — example `a5a33eae-ad73-469b-b7aa-917e0900a5a9`

> A Jetson Nano case: rectangular box 111mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-C cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 111mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Are there four standoff posts visible inside the case at the corners? | **fail** — 45° down view and top view show only one standoff post clearly visible near one corner; the other three corner standoffs are not visible in any of the eight views | **pass** — Top view: four small circular posts are visible at the four corners of the case interior; 45° down view shows at least one post clearly. | same |  |

## 23. Gridfinity Storage — example `aeca37d7-497b-475e-9039-2527d7c1e655`

> Create a 2x1 Gridfinity bin, 4 height units tall, no compartments, with a stacking lip

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is there a visible raised stacking lip around the top perimeter? | **fail** — Front, back, left, right, and 45° up views all show a flat top rim with no visible outward-stepping or chamfered stacking lip protrusion around the perimeter; the top rim appears flush with the outer wall | **pass** — 45° down view shows a raised rim around the top edge; top view shows a uniform border ring around the cavity opening. | same |  |
| 5 | Is the overall height roughly equal to the width (i.e., relatively tall relative to the short dimension)? | **fail** — Left and right views show the bin height is noticeably less than the depth dimension — the bin appears wider than it is tall, which is consistent with a 4-unit height (28mm) vs ~41.5mm depth, but the bin looks quite shallow relative to its footprint, suggesting the height-to-short-side ratio is less than 1:1 as expected | **pass** — Front view shows height approximately equal to the short dimension (depth), consistent with a 4-unit tall bin; left view confirms a tall, narrow profile. | same |  |

## 24. Gridfinity Storage — example `b04a8444-3538-46e7-ac69-364478716578`

> Create a 5x3 Gridfinity baseplate with full blocks and magnet holes in all bottom corners

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 4 | Are all 15 cells fully filled (no skeletonized or hollow cells)? | **pass** — [2x zoom] Top view: The baseplate shows a continuous solid flat surface across all 15 cell positions (5 columns × 3 rows) with no hollow openings, cutouts, or skeletonized areas — only the small circular magnet hole impressions are visible, and the entire surface between them is fully solid material. | **fail** — Top view shows cells are not filled with raised blocks; only small corner bumps are present, leaving most of each cell as flat baseplate | same |  |

## 25. Hinges — example `b4f1e555-89d5-4a48-9d2c-9cd3e793271c`

> A 150mm continuous piano hinge segment with two 40mm-wide leaves, 1.5mm thick, joined by alternating 8mm-pitch knuckles on a 2.5mm pin. 3.5mm mounting holes spaced every 30mm along each leaf.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Does a single continuous pin visibly pass through all knuckles? | **fail** — [2x zoom] Top view: The knuckle row shows individual barrel segments alternating along the hinge line, but no distinct continuous cylindrical pin is visible passing through all knuckles — the bores appear open/empty with no pin element protruding from or visible at the ends of the barrel row, and the knuckles appear as separate segments without a unifying pin shaft visible. | **pass** — Left and right views show a thin continuous line (the pin) running the full length through the knuckle row; the 45° views show the pin line running through the knuckles. | same |  |

## 26. PCB Cases — example `b6caba81-ac31-4aad-9515-d3e05a8e9943`

> A Raspberry Pi 3 Model B+ case with an integrated camera platform on the lid. The base is the standard Pi 3 B+ case (90mm × 65mm × 25mm with 2mm walls, four M2.5 standoffs 5mm tall at the Pi mounting positions, port cutouts for USB-A and Ethernet on one long side). The lid (90mm × 65mm × 3mm) has a 25mm × 24mm raised platform (3mm tall) centered on top, with a 10mm × 2mm slot through the platform for a ribbon cable. Display the case upright and the lid upside-down beside it on the same flat surface, separated by a 20mm gap.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Are there four standoff posts visible inside the base? | **fail** — 45° down view and top view: only one cylindrical standoff post is clearly visible inside the base interior; the other three are not discernible, though partial occlusion by walls may hide some | **pass** — Top view: four small circular posts visible at the four corners of the base interior; 45° down view: at least one post clearly visible inside the cavity. | same |  |

## 27. PCB Cases — example `b86a0f72-a4f8-4d27-9b6e-9008c97c94ad`

> An Adafruit Feather RP2040 case. Board is 51mm × 23mm; USB-C replaces micro-USB. Same geometry as Feather M0 otherwise. Lid has a small reset button access hole (3mm diameter). Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is the lid placed upside down (flat top face against the ground, rim/lip facing up)? | **fail** — 45° down view: the lid shows its flat top surface facing upward with the perimeter lip outline visible from above, indicating the flat exterior is facing up rather than down as specified. | **pass** — 45° up view shows the lid's underside with the perimeter lip ring visible and the reset hole on the underside; bottom view shows the lid as a flat rectangle with the reset hole, confirming the flat exterior face is down and the lip faces up. | same |  |

## 28. Hinges — example `bb59ae21-ef1a-4c2b-9df6-79eb5b48b0a0`

> A European-style concealed cup hinge: a 35mm-diameter x 12mm-deep cylindrical cup with a 2mm-wide mounting flange rim. A single arm extends 55mm from the cup, 12mm wide x 10mm tall, ending in a flat 40mm x 12mm mounting plate with two elongated 4mm x 8mm adjustment slots.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is the mounting plate flat and wider than the arm's length dimension? | **pass** — Front and 45° down views: the mounting plate is flat and extends beyond the arm end, appearing longer than the arm is tall, with a visible step-down in thickness | **fail** — Top view shows the plate is the same width as the arm (12mm), not wider; the plate appears as a thin extension rather than a distinct flat plate. | same |  |
| 5 | Are the two slots roughly symmetric about the plate's centerline? | **pass** — [2x zoom] 45° up view: The bottom face of the mounting plate is visible, showing two elongated slots positioned symmetrically along the plate's long axis centerline (Y=0), one near the inner end and one near the outer end of the plate, with equal margins from each end and equal spacing about the plate's center. | **fail** — Only one slot is visible, so symmetry cannot be assessed; the single slot appears roughly centered on the plate's width but there is no second slot to be symmetric with. | same |  |

## 29. Hinges — example `bd78cd78-fca7-4c61-bada-db3992f590ab`

> A T-hinge with one short butt leaf (50mm x 50mm x 2mm) and one long strap leaf (180mm x 35mm x 2mm) tapering to 20mm at the tip. The butt leaf has three 4mm holes; the strap has four. Five barrel knuckles with a 3mm pin.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is the strap leaf visibly tapered (wider near the barrel, narrower at the tip)? | **pass** — Top view and bottom view: the strap leaf clearly narrows from the barrel end toward the far tip, showing a distinct trapezoid/taper profile | **fail** — Top and bottom views show the strap leaf as a constant-width rectangle with no visible taper. | same |  |
| 6 | Is a pin visible running through all 5 knuckles? | **pass** — 45° up and 45° down views: a cylindrical rod/pin element is visible at the barrel junction running along the barrel axis, consistent with a hinge pin | **fail** — The pin appears as a thin rod that does not clearly pass through the barrel bore; it looks like a separate thin line rather than a 3mm pin filling the knuckle bores. | same |  |

## 30. Gridfinity Storage — example `c41e28b4-3e12-413d-b21b-faa2e151d940`

> Create a 6x4 Gridfinity baseplate using full solid blocks

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Does each grid cell show the standard Gridfinity raised/chamfered mating lip profile on the top surface? | **fail** — [2x zoom] 45° down view: each of the 24 cells shows only a shallow flat recess with a simple narrow rim — there is no visible chamfer/angled lead-in or stepped mating lip profile at the inner top edge of any pocket; the pockets appear as plain rectangular cutouts without the required 45° chamfer and 0.5mm ledge step. | **pass** — Top view: each cell shows a raised rim with a recessed pocket and visible chamfered inner edge; 45° down view shows the stepped recess profile with chamfer and ledge on each cell. | same |  |

## 31. Generic Enclosures — example `c7185bf2-a863-4a61-a91e-ed91abfd69ca`

> A simple Raspberry Pi Zero enclosure: 68mm × 32mm × 18mm, 2mm walls, open on top (no top face), with cutouts for the micro-USB port (10mm × 5mm), mini HDMI (12mm × 5mm), and camera ribbon (22mm × 3mm) slots.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 4 | Is the camera ribbon slot visibly wider than the HDMI and USB slots? | **fail** — Back view and 45° down view: the camera ribbon slot feature appears as a very small notch, not visibly wider than the two port cutouts on the opposite end wall shown in the 45° up view. | **pass** — 45° down view: the slot on the left end wall is visibly much wider than either slot on the right end wall, matching a 22mm ribbon slot vs 10–12mm port slots. | same |  |

## 32. PCB Cases — example `c7557c3a-def6-4385-98ea-5441fa63a83e`

> A Wemos D1 Mini case. The board is 34mm × 25mm. The case has 2mm standoffs at the four corners; micro-USB cutout on the short end. Display as an exploded view with all parts on the same vertical axis and a 15mm gap between them.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Is there a rectangular cutout on one of the short-end walls of the bottom shell? | **pass** — 45° down view shows a dark rectangular recess on one short end of the shell, consistent with a micro-USB cutout; not clearly visible in straight side views due to viewing angle | **fail** — Front and back views: The short-end walls appear solid with no visible rectangular cutout or slot. | same |  |

## 33. Hinges — example `ce1d818d-2c9c-49dc-a462-b558351c86fc`

> A Soss-style invisible hinge: two rectangular mortise housings (each 15mm x 60mm x 10mm deep) connected by a multi-bar linkage consisting of three parallel 50mm-long x 5mm-wide x 2mm-thick links with 3mm pivot pins at each end. The hinge is fully concealed when closed.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 5 | Are the two housings mirror-symmetric about the center plane? | **pass** — Front, left, and 45° down views show both housing blocks are identical rectangular solids of the same size, positioned symmetrically at top and bottom of the assembly with matching pin hole patterns visible in left/right views | **fail** — 45° down and 45° up views: the upper housing has pins protruding upward while the lower housing has pins protruding downward, and the pin hole patterns are not mirror images of each other about the center plane. | same |  |

## 34. Generic Enclosures — example `cebf8316-c7e8-4542-943c-49b3b1888998`

> A simple signal relay enclosure with terminal blocks on one face: 100mm × 60mm × 50mm box, 3mm walls, open on top (no top face), four 8mm terminal block entry holes on one face.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Is the box open on the top (no top face)? | **fail** — 45° down view and top view: both show a solid, flat, light-blue top surface covering the full footprint of the box — no open cavity is visible from above | **pass** — Top view shows a flat open rectangle with no top face material; 45° down view shows the open top with visible interior cavity and wall edges. | same |  |

## 35. PCB Cases — example `e0febd7c-479b-4506-b838-37960eab499f`

> A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Are there four cylindrical standoff posts visible at the interior corners of the box? | **fail** — 45° down view: only one cylindrical standoff post is clearly visible in the near-left interior corner; the other three corner positions show no visible standoff cylinders, suggesting they are either missing or completely occluded — but given the open top view should reveal all four, their absence is a concern | **pass** — Top view: four small circular posts are visible at the interior corners of the case; 45° down view shows at least one post clearly. | same |  |

## 36. PCB Cases — example `eb61185b-17fc-4750-982d-fa32d75195de`

> A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Are there exactly three cutouts visible on one short wall of the box? | **fail** — 45° down view and left view: cutouts are visible on the short wall, but only 1–2 distinct rectangular openings are clearly distinguishable; three separate cutouts (USB 12×7, Ethernet 17×15, HDMI 16×6) are not all clearly resolved | **pass** — 45° down view: three rectangular cutouts of differing sizes are visible on the short wall facing the camera; left view: three cutout shapes are visible on the wall face. | same |  |
| 3 | Are there four cylindrical standoff posts visible at the interior corners of the box? | **fail** — [2x zoom] Top view: Four small circular features are visible near the corners of the box interior, but the 45° down view shows only one cylindrical standoff post visible (near the far interior corner), not four posts at all interior corners — the other three corner positions appear empty, indicating not all four standoff posts are present/visible. | **pass** — top view: four small circular posts with central holes are visible at the four interior corners of the case; 45° down view: at least two posts are visible inside the case. | same |  |

## 37. Hinges — example `f05857ba-030c-450f-a507-8f95a4466904`

> A concealed barrel hinge: two 12mm-diameter cylindrical halves, each 40mm long, connected by an internal 4mm pivot pin. Each half has a 10mm-long flat mounting tab extending radially, 15mm wide x 2mm thick, with a single 4mm screw hole.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Are there exactly two semi-cylindrical barrel halves? | **fail** — [2x zoom] 45° down view: The barrel appears as a single full cylinder (not split into two semi-cylindrical halves), with two rectangular mounting tabs projecting in opposite directions — there is no visible seam or flat mating face indicating two separate half-cylinder components. | **pass** — Left/right views show a central cylinder split by a vertical seam line into two halves; top/bottom views show a full circle with a horizontal seam line dividing it into two semicircular halves. | same |  |

## 38. PCB Cases — example `f06eafd6-1346-4480-89c2-c9c6c594669e`

> A Raspberry Pi Zero 2 case: rectangular box 73mm x 38mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: micro-USB cutout (10mm x 5mm). Flat lid 73mm x 38mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 5 | Are the two parts separated by a visible gap on the same flat surface? | **pass** — 45° down view and front view: both parts rest on the same Z=0 plane with a clear gap between them | **fail** — Front and back views show the lid directly adjacent to the box with no visible gap between them; both rest on the same flat surface. | same |  |
| 6 | Is the lid placed upside down (flat face down on the surface)? | **pass** — 45° down view: the lid appears as a flat plate with its broad face resting on the surface, consistent with being placed upside down (flat top facing down) | **fail** — 45° down view shows the lid's flat surface facing upward; the lid appears to be in its normal orientation rather than inverted. | same |  |

## 39. Gridfinity Storage — example `f2f988f5-18ae-4ee0-acc7-45221467cc19`

> Create a 1x1 Gridfinity bin, 7 height units tall (extra deep), with a stacking lip — good for holding pens or markers upright

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 4 | Does the base have the characteristic Gridfinity chamfered/stepped bottom profile for baseplate engagement? | **fail** — [2x zoom] 45° up view: The base of the model shows a flat, smooth bottom with rounded corners and no visible chamfered or stepped profile — there is no angled entry lip or stepped exterior geometry characteristic of the Gridfinity baseplate engagement profile at the bottom of the bin. | **pass** — Bottom view and 45° up view show a chamfered/stepped bottom edge with rounded corners, consistent with a Gridfinity base engagement profile. | same |  |

## 40. PCB Cases — example `f49ccea5-8e77-4f28-b42e-6f3864060587`

> A Arduino Mega 2560 case: rectangular box 109mm x 61mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm). Flat lid 109mm x 61mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 2 | Are there exactly 4 standoff posts visible inside the box? | **fail** — Top view and 45° down view: only 1 standoff post is clearly visible near one corner of the interior; the other 3 corner standoffs are not visible in any of the 8 views, suggesting they are missing from the model. | **pass** — Top view: shows 4 small circular posts at the interior corners of the box; 45° down view: shows at least one standoff post visible inside the box. | same |  |

## 41. PCB Cases — example `f4d6cff1-460c-493f-88a4-91b24f26de5b`

> A ESP32 WROOM case: rectangular box 59mm x 36mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: a USB cutout (12mm x 7mm). Flat lid 59mm x 36mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 1 | Does the box have a USB-shaped rectangular cutout on one short side? | **pass** — 45° down view and front view: a rectangular slot is visible on one short side of the box, consistent with a USB cutout | **fail** — Front, back, left, right, and 45° views: no rectangular cutout is visible on any short side of the case. | same |  |
| 6 | Is the lid oriented upside down (flat face down, any rim facing up)? | **pass** — 45° up view: the lid shows a flat bottom face touching the ground plane with no rim visible — consistent with a plain flat plate placed upside down | **fail** — 45° down and 45° up views: the lid appears as a thin flat sheet with no visible rim or thickness; orientation as an upside-down plate with a rim is not evident. | same |  |

## 42. PCB Cases — example `f6cf328b-e178-4cdd-be67-f8dbf44e8efa`

> A Raspberry Pi Zero 2 W case with outer dimensions 74mm x 36mm x 14mm and 2mm walls. The base holds the board on four 2mm-tall standoffs. Port cutouts on one short edge: two micro-USB openings (10mm x 5mm each, 3mm apart). On one long edge: a mini-HDMI opening (12mm x 5mm, centered). On the opposite long edge: a camera ribbon slot (22mm x 3mm, centered). Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 4 | Are there two rectangular cutouts visible on one short wall of the base? | **fail** — Front view and back view: the short wall of the base shows only one small rectangular opening; two distinct separated cutouts are not distinguishable in any view including the 45° down view | **pass** — Front view shows two small rectangular openings on the short end wall of the base; 45° down view also shows two cutouts on that end wall. | same |  |

## 43. Gridfinity Storage — example `f79d8243-29d9-4507-aeee-9a5e7ddfc2ac`

> Create a 6x6 Gridfinity baseplate with skeleton blocks

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Does each cell show the characteristic Gridfinity chamfered/stepped female connector recess? | **fail** — Top view and 45° down view: each cell appears as a flat open square with rounded corners; no visible chamfer lead-in, shoulder ledge, or inner recess step is discernible — the socket profile detail appears absent. | **pass** — The 45° down view shows each cell with a chamfered top edge and a stepped inner recess; the 45° up view shows the corresponding stepped profile from below. | same |  |

## 44. PCB Cases — example `fea1a4fa-d9c8-4872-b725-aab1426740f4`

> A Seeed reTerminal enclosure mock-up (standalone front bezel). 170mm × 100mm front frame with a 148mm × 84mm window for the 5-inch touchscreen, two 8mm button cutouts on the right side, and a USB-A cutout on the top edge. 3mm wall thickness.

| # | item | Claude Sonnet 4.6 (Anthropic API, thinking off) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | chat3d-judge-rc0 (rc0 LoRA merge, BF16, thinking off, spark-01) | verdict |
|---|---|---|---|---|---|
| 3 | Is there a rectangular cutout on the top edge of the frame? | **fail** — Top view shows a small rectangular cutout on the top edge of the frame (correct), but the bottom view and 45° up view show the rectangular USB-A cutout appearing on the bottom edge rather than the top edge, suggesting the cutout may be placed on the wrong edge. | **pass** — Top view shows a small rectangular notch in the top border strip; the 45° down view shows the same rectangular cutout on the top edge. | same |  |
