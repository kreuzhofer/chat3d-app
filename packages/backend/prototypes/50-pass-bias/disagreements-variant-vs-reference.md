# Disagreements: variant `2410f9d2` vs reference `786b6e3c` (control `3b5edb08` alongside)

## ref fail → variant pass — 19 items

### Hinges · `086dc6b0` · item 3
**Prompt:** A butterfly hinge with two symmetrical wing-shaped leaves, each 70mm tall x 40mm wide x 2mm thick. The leaf profile is a stylized butterfly wing with a concave waist narrowing to 15mm near the barrel. Three 3.5mm mounting holes per leaf. Five barrel knuckles on a 3mm pin.

**Item:** Does each leaf show exactly 3 circular mounting holes?

- **reference (fail)**: The bottom view shows only 2 holes per leaf (4 total), positioned symmetrically in the upper and lower lobe regions. The third hole per leaf (expected near the waist/center at X=±28, Y=0) is not visible in any view, suggesting it may be missing from the model.
- **variant (pass)**: [2x zoom] The image shows the butterfly hinge with two leaves, but I see no mounting holes on either leaf surface — the plates appear solid with no circular holes.{ "pass": false, "detail": "Both leaf plates ap
- **control (pass)**: Bottom view shows 3 holes per leaf (two near lobes, one near waist); 45° up view confirms 3 holes on each leaf.

### Generic Enclosures · `2e16e9ba` · item 1
**Prompt:** A simple 3D-printed wall switch plate: flat plate 83mm x 83mm x 8mm with a rectangular cutout 21mm x 15mm for a rocker switch in the center, and two M3 mounting holes 60mm apart vertically.

**Item:** The rectangular cutout center and both circular hole centers all share the same x=0 coordinate (horizontally centered on the plate)

- **reference (fail)**: In the top and bottom views, the rectangular cutout appears centered on the plate, but the two circular holes appear offset to opposite sides horizontally (one to the left, one to the right of center), rather than both being centered at x=0 along with the cutout
- **variant (pass)**: Top and bottom views: the rectangular cutout sits at the horizontal center of the square plate, and both circular holes lie on the same vertical centerline as the cutout, all horizontally centered. 45° down/up views confirm the holes and cutout are aligned along the plate's center axis.
- **control (pass)**: Top and bottom views show the rectangular cutout and both circular holes aligned on the vertical centerline of the plate.

### Hinges · `30f7cab2` · item 1
**Prompt:** A long strap hinge: two tapered leaves, each 200mm long tapering from 40mm wide at the barrel end to 20mm wide at the tip, 2.5mm thick. Five 4mm mounting holes per leaf. Barrel with five knuckles and a 3.5mm pin.

**Item:** Do both leaves taper visibly from a wider barrel end to a narrower tip?

- **reference (fail)**: In the top, bottom, and isometric views the leaves appear as uniform-width straps with no visible trapezoidal taper; the edges run nearly parallel from end to end.
- **variant (pass)**: Top and bottom views: both leaves are widest at the center (barrel end) and narrow toward the tips, showing a clear trapezoidal taper on each side.
- **control (pass)**: Top/bottom views show both leaves narrowing from the center toward the tips

### Hinges · `30f7cab2` · item 5
**Prompt:** A long strap hinge: two tapered leaves, each 200mm long tapering from 40mm wide at the barrel end to 20mm wide at the tip, 2.5mm thick. Five 4mm mounting holes per leaf. Barrel with five knuckles and a 3.5mm pin.

**Item:** Are the two leaves extending in opposite directions from the shared barrel?

- **reference (fail)**: The assembly appears as a single continuous flat strap; there is no visible separation or opposing orientation of two distinct leaves from a central barrel point.
- **variant (pass)**: Top view: the two leaves extend in opposite directions from the center, forming a shallow V/straight strap configuration.
- **control (pass)**: Leaves extend in opposite directions from the central barrel region

### Gridfinity Storage · `427d888e` · item 1
**Prompt:** Create a 4x4 Gridfinity baseplate using frame-style blocks

**Item:** Bottom face is a single continuous flat plane at Z = 0 with no protrusions or recesses below datum

- **reference (fail)**: The bottom view shows open cell openings (white/transparent areas) indicating the pockets are full through-cuts with no solid bottom face — the bottom is a lattice frame, not a continuous flat plane
- **variant (pass)**: Bottom view: shows a flat continuous grid lattice face with no visible protrusions or recesses; 45° up view confirms flat underside with no magnet holes or bosses.
- **control (pass)**: Bottom view shows a flat continuous lattice with no visible protrusions or recesses below the datum.

### PCB Cases · `4e3686ec` · item 5
**Prompt:** A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid

**Item:** Is the lid oriented upside-down (flat face facing downward)?

- **reference (fail)**: [2x zoom] Looking at the image, I can see two objects: 1. On the left: a taller rectangular shape (the case body) with visible height/thickness 2. On the right: a very thin, flat rectangular shape (the lid) tha
- **variant (pass)**: [2x zoom] The image shows a case (tall rectangle) and a thin flat lid lying flat at Z=0-3mm, resting on the same ground plane. The lid appears as a thin horizontal strip at the same base level as the case, cons
- **control (pass)**: [2x zoom] The image shows a cross-section view: case (left, hollow box visible as rectangle) and lid (right, thin flat plate resting on ground). The lid appears as a thin flat plate at the bottom. Since the lid

### Gridfinity Storage · `56a2ef96` · item 4
**Prompt:** Create a 3x1 Gridfinity base with screw holes and magnet holes in the bottom corners

**Item:** Does the top surface have a raised lip/profile around each of the 3 cell positions?

- **reference (fail)**: Top view shows cell divisions but no raised stepped Gridfinity lip profile is visible; side views show a flat plate with no wall height variation
- **variant (pass)**: Top view: three rectangular recessed areas with raised borders and dividers between cells, consistent with Gridfinity base profile.
- **control (pass)**: Top view shows the stepped Gridfinity lip profile around each of the 3 cells with dividing walls between cells.

### Gridfinity Storage · `9e794b0a` · item 2
**Prompt:** Create a 3x3 Gridfinity baseplate using skeleton blocks for minimal material usage

**Item:** Does each cell have a raised lip/chamfered entry profile for Gridfinity bin compatibility?

- **reference (fail)**: No clear lip profile visible in any view; cells appear as simple open frames without the standard Gridfinity chamfer/vertical wall/fillet lip geometry
- **variant (pass)**: [2x zoom] The image shows a skeleton baseplate with 9 cells. Each cell has a rim ring; the top edges appear to have filleted/chamfered entry — I can see rounded rim highlights around each cell. The spec says ea
- **control (fail)**: [2x zoom] Looking at the image: a 3×3 skeleton baseplate. The cells appear as flat rims with large through-holes. Is there a raised lip/chamfered entry profile? The rims look flat and thin — the through-holes s

### PCB Cases · `a5a33eae` · item 2
**Prompt:** A Jetson Nano case: rectangular box 111mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-C cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 111mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) an

**Item:** Are there exactly three cutout openings on one short wall of the case?

- **reference (fail)**: The 45° down view shows what appears to be two rectangular cutouts on the short wall, not three distinct openings of visibly different proportions. The front/back views show no cutout detail at all.
- **variant (pass)**: [2x zoom] The image shows a case with a short wall visible on the left side with three rectangular cutouts (small, large, medium). Yes, three cutouts visible on one short wall.{"pass": true, "detail": "The left
- **control (fail)**: Only two cutouts are visible on the short wall; the middle (Ethernet) opening appears absent or not cut through

### Gridfinity Storage · `aeca37d7` · item 3
**Prompt:** Create a 2x1 Gridfinity bin, 4 height units tall, no compartments, with a stacking lip

**Item:** Is there a visible raised stacking lip around the top perimeter?

- **reference (fail)**: The side views and 45° up view do not show a clearly distinct stepped stacking lip at the top rim; the top appears relatively flat without the characteristic Gridfinity lip protrusion
- **variant (pass)**: Top view shows a distinct rim/ledge around the opening; 45° down view shows the top edge stepping outward at the rim, consistent with a stacking lip.
- **control (pass)**: The top view shows a distinct rim/ledge around the opening, and the 45-degree down view shows the lip step at the top edge.

### Gridfinity Storage · `aeca37d7` · item 5
**Prompt:** Create a 2x1 Gridfinity bin, 4 height units tall, no compartments, with a stacking lip

**Item:** Is the overall height roughly equal to the width (i.e., relatively tall relative to the short dimension)?

- **reference (fail)**: The bin appears relatively shallow — the height looks less than the depth dimension (short side), suggesting the bin may be shorter than expected for 4 height units relative to a 1-unit depth
- **variant (pass)**: Front view shows height roughly two-thirds of the width, matching a 4-unit-tall bin (28mm vs 83.5mm width, taller than a standard 3-unit bin relative to the 41.5mm depth).
- **control (pass)**: Side views show a tall bin whose height is comparable to the short-side width, consistent with a 4-unit-tall bin.

### Hinges · `b4f1e555` · item 2
**Prompt:** A 150mm continuous piano hinge segment with two 40mm-wide leaves, 1.5mm thick, joined by alternating 8mm-pitch knuckles on a 2.5mm pin. 3.5mm mounting holes spaced every 30mm along each leaf.

**Item:** Does a single continuous pin visibly pass through all knuckles?

- **reference (fail)**: [2x zoom] The interleaved knuckles are visible along the hinge line, but no single continuous pin is visibly distinguishable passing through all knuckle bores — the pin does not appear as a distinct visible element in the image.
- **variant (pass)**: [2x zoom] The image shows a hinge with knuckles along the center line. Is there a pin visibly passing through? At the right end, there appears to be a rounded end (small cylinder end visible at right end of knu
- **control (pass)**: Left/right views show a continuous pin end protruding at the barrel axis center; the knuckle bores align along the axis.

### PCB Cases · `b6caba81` · item 6
**Prompt:** A Raspberry Pi 3 Model B+ case with an integrated camera platform on the lid. The base is the standard Pi 3 B+ case (90mm × 65mm × 25mm with 2mm walls, four M2.5 standoffs 5mm tall at the Pi mounting positions, port cutouts for USB-A and Ethernet on one long side). The lid (90mm × 65mm × 3mm) has a 25mm × 24mm raised platform (3mm tall) centered on top, with a 10mm × 2mm slot through the platform 

**Item:** Is the lid oriented upside-down (platform facing downward toward the surface)?

- **reference (fail)**: In the 45° down view the platform appears raised upward on the lid surface, suggesting the lid is not flipped; the 45° up view shows a flat underside with only a slot, which is ambiguous
- **variant (pass)**: Left and right views: the lid lies flat on the ground with only a thin low profile, and the 45° down view shows the platform edge flush against the ground with the platform face down; the top surface of the lid is flat, confirming the platform faces downward
- **control (pass)**: 45° down view shows the lid lying flat with the platform on top — wait, if flipped, platform faces down. In the 45° down view the platform appears raised upward on the lid. Hmm.

### Hinges · `bd78cd78` · item 5
**Prompt:** A T-hinge with one short butt leaf (50mm x 50mm x 2mm) and one long strap leaf (180mm x 35mm x 2mm) tapering to 20mm at the tip. The butt leaf has three 4mm holes; the strap has four. Five barrel knuckles with a 3mm pin.

**Item:** Does the butt leaf have 3 holes and the strap leaf have 4 holes?

- **reference (fail)**: Strap leaf shows 4 holes clearly in top/bottom views; butt leaf holes are not visible in any view
- **variant (pass)**: Top and bottom views show 3 holes on the butt-leaf bar and 4 holes along the strap leaf; the 45° views confirm 4 holes on the strap.
- **control (pass)**: Top view shows 4 holes along the strap; the butt leaf region shows hole(s) but 3 holes are not clearly resolvable — partially confirmed.

### Generic Enclosures · `c97ce502` · item 2
**Prompt:** A simple motor driver enclosure: 80mm × 60mm × 30mm, 3mm walls, large ventilation slot 60mm × 5mm on top, terminal block holes on each short end.

**Item:** The model contains exactly three distinct void regions: one interior cavity and two terminal block cutouts and one ventilation slot (four total through/into features), all accessible from their respective faces

- **reference (fail)**: [2x zoom] Looking at this high-resolution image, I can see a top-down view of a rectangular box (light blue) with a single rectangular cutout visible in the center of the face being shown.  From this viewing an
- **variant (pass)**: Front and back views each show one rectangular terminal block cutout centered on the wall; top view shows one long ventilation slot; 45° down view confirms the slot and a terminal cutout with visible wall thickness, indicating a hollow interior. All requested voids are present and accessible.
- **control (pass)**: Ventilation slot visible on top (top view and 45° down view), terminal block slots visible on front and back faces (front/back views and both 45° views). Interior cavity not directly visible but implied by through-features; no extra geometry observed.

### PCB Cases · `e0febd7c` · item 5
**Prompt:** A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid

**Item:** Is the lid oriented upside-down (flat face facing downward)?

- **reference (fail)**: [2x zoom] Looking at the image, I can see two objects: on the left is the case body (showing its open top with standoffs visible), and on the right is what appears to be the lid - shown as a very thin, flat rec
- **variant (pass)**: [2x zoom] The image is a front/side view showing the case and lid. The lid appears as a thin plate with its bottom edge at the same level (Z=0) as the case bottom. In this side view, we see the lid as a thin re
- **control (pass)**: [2x zoom] The image shows a case and a thin flat lid plate. The lid is a simple flat plate — orientation "upside-down" is ambiguous for a featureless plate, but it rests flat on Z=0 plane. From the side view, t

### PCB Cases · `eb61185b` · item 2
**Prompt:** A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid

**Item:** Are there exactly three cutouts visible on one short wall of the box?

- **reference (fail)**: [2x zoom] On the visible short wall, I can only clearly distinguish 2 cutout openings (one taller rectangular cutout and one smaller one), not 3 distinct cutouts as specified. The third cutout is not visible or identifiable in this high-resolution view.
- **variant (pass)**: Left view shows the short wall with three rectangular cutouts of differing sizes arranged along the wall; the 45° down view also shows openings on the near short wall.
- **control (pass)**: Left view shows three rectangular openings on the short wall; 45° down view also shows cutouts on that wall.

### PCB Cases · `eb61185b` · item 3
**Prompt:** A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid

**Item:** Are there four cylindrical standoff posts visible at the interior corners of the box?

- **reference (fail)**: [2x zoom] Only one cylindrical standoff post is visible in the image (near the upper-left interior corner). The other three posts that should be at the remaining interior corners are not visible, suggesting they are either missing from the model or only partially rendered. Four posts are required but only one can be confirmed.
- **variant (pass)**: Top view shows four small circular posts at the interior corners of the open box; the 45° down view shows at least one standoff post rising from the interior floor near a corner.
- **control (pass)**: Top view shows four small circular posts at the interior corners; 45° down view confirms posts inside the box.

### Hinges · `f05857ba` · item 1
**Prompt:** A concealed barrel hinge: two 12mm-diameter cylindrical halves, each 40mm long, connected by an internal 4mm pivot pin. Each half has a 10mm-long flat mounting tab extending radially, 15mm wide x 2mm thick, with a single 4mm screw hole.

**Item:** Are there exactly two semi-cylindrical barrel halves?

- **reference (fail)**: [2x zoom] The image shows what appears to be a full cylinder (not two semi-cylindrical halves) with two rectangular mounting tabs projecting in opposite directions. The barrel appears as a complete circular cylinder rather than two distinct D-shaped semi-cylindrical halves. There is no visible seam or flat face indicating two separate half-cylinders joined at the XZ plane.
- **variant (pass)**: Top view and 45° down view show a full cylinder split by a seam line into two halves; 45° down view shows the parting line running along the length.
- **control (pass)**: Top view shows two half-cylinders separated by a seam line, forming a full cylinder.

## ref pass → variant fail — 42 items

### Gridfinity Storage · `230a3336` · item 1
**Prompt:** Create a 1x1 Gridfinity bin, 5 height units, no compartments, no lip — a simple deep cup bin

**Item:** Is the top edge open with no lip or rim overhang?

- **reference (pass)**: [2x zoom] The top surface appears flat with no lip, rim overhang, or stacking tab visible. The top edge is clean and open, consistent with the NoLip variant specification.
- **variant (fail)**: Top view and 45° down view: the top is a completely closed, flat solid surface with no opening, cavity, or walls — there is no open top edge at all
- **control (fail)**: The top view shows a completely flat, solid surface with no opening — the bin is not hollow at all

### Gridfinity Storage · `230a3336` · item 2
**Prompt:** Create a 1x1 Gridfinity bin, 5 height units, no compartments, no lip — a simple deep cup bin

**Item:** Is the interior a single undivided cavity (no compartment dividers)?

- **reference (pass)**: [2x zoom] The model appears as a solid closed-top bin viewed from above at an isometric angle. The top surface is a single uninterrupted flat face with no visible dividers, walls, or compartment separators. The interior cavity is not visible from this angle, but there are no external indicators of internal dividers penetrating the top surface, consistent with a single undivided cavity.
- **variant (fail)**: Top view and 45° down view: no interior cavity of any kind is visible; the model appears to be a solid slab, so there is no undivided cavity
- **control (fail)**: There is no visible interior cavity of any kind; the model appears to be a solid block

### PCB Cases · `3069c73d` · item 1
**Prompt:** An Adafruit Feather RP2040 case. Board is 51mm × 23mm; USB-C replaces micro-USB. Same geometry as Feather M0 otherwise. Lid has a small reset button access hole (3mm diameter). Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

**Item:** Does the scene show exactly two separate parts (case body and lid) side by side?

- **reference (pass)**: Top view clearly shows two distinct parts — an open-cavity case body on the left and a flat lid plate on the right with a circular hole
- **variant (fail)**: Top view and 45° down view: only a single open-top rectangular case body is visible; no second flat part (lid) appears anywhere in the scene.
- **control (fail)**: Top view shows a single merged footprint; the lid is not clearly separated from the case body

### PCB Cases · `3069c73d` · item 3
**Prompt:** An Adafruit Feather RP2040 case. Board is 51mm × 23mm; USB-C replaces micro-USB. Same geometry as Feather M0 otherwise. Lid has a small reset button access hole (3mm diameter). Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

**Item:** Is the lid placed upside down (flat top face against the ground, rim/lip facing up)?

- **reference (pass)**: 45° up view shows the lid as a solid block with a thin lip line at the bottom edge, consistent with inverted placement; the flat exterior face is on the ground
- **variant (fail)**: Top view and 45° down view: no lid object is present in the scene, so its orientation cannot be confirmed and the feature is absent.
- **control (fail)**: [2x zoom] The image shows only one rectangular object viewed from above — a lid with a reset hole visible, viewed from top. The question asks if the lid is upside down (flat top face against ground, lip facing

### PCB Cases · `3069c73d` · item 4
**Prompt:** An Adafruit Feather RP2040 case. Board is 51mm × 23mm; USB-C replaces micro-USB. Same geometry as Feather M0 otherwise. Lid has a small reset button access hole (3mm diameter). Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

**Item:** Is there a visible gap between the two parts?

- **reference (pass)**: Top view shows a clear separation between the two parts; however the gap is not visible in side views
- **variant (fail)**: Top view and 45° down view: only one part exists, so no gap between two parts can be seen.
- **control (fail)**: No gap is visible; the parts appear contiguous in the top view

### PCB Cases · `3069c73d` · item 5
**Prompt:** An Adafruit Feather RP2040 case. Board is 51mm × 23mm; USB-C replaces micro-USB. Same geometry as Feather M0 otherwise. Lid has a small reset button access hole (3mm diameter). Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

**Item:** Is there a circular hole visible on the lid's surface?

- **reference (pass)**: Top view clearly shows a circular hole (reset button access) on the right-side part (lid), positioned toward one end
- **variant (fail)**: Top view and 45° down view: no lid is present, and no circular hole appears on any visible surface of the case body.
- **control (pass)**: A small circular hole is visible in the top view and in the 45-degree down view

### PCB Cases · `3d5ac379` · item 1
**Prompt:** A Raspberry Pi 4 compute case: rectangular box 93mm x 64mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 93mm x 64mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open si

**Item:** Is the box open on the top face (no lid geometry on the box itself)?

- **reference (pass)**: The 45° down view clearly shows the box interior is open at the top with hollow cavity visible
- **variant (fail)**: 45° down and top views: the box is a thin flat plate with no side walls, so there is no open-top enclosure — the walls that would define the cavity are missing entirely
- **control (pass)**: Top view shows an open rectangular cavity with interior floor visible; no lid covering the box.

### PCB Cases · `3d5ac379` · item 6
**Prompt:** A Raspberry Pi 4 compute case: rectangular box 93mm x 64mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 93mm x 64mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open si

**Item:** Is the lid inverted (flat top face touching the ground plane)?

- **reference (pass)**: [2x zoom] The lid appears as a flat, featureless rectangle in the top-down view, consistent with being placed inverted (flat top face touching the ground plane at Z=0), showing uniform thickness with no raised features visible from above.
- **variant (fail)**: 45° down and 45° up views: the lid is tilted at an angle with a raised edge rather than lying flat with its top face down on the ground plane
- **control (pass)**: [2x zoom] This appears to be a top-down view of the model. We see the box interior with standoffs (four circles) and port cutouts, and the lid as a flat rectangle. From top view, we can't directly see if the li

### Hinges · `4257c1e4` · item 1
**Prompt:** A decorative strap hinge with two 150mm-long leaves featuring a pointed arrowhead tip. Each leaf is 30mm wide, 2mm thick, with four 4mm mounting holes. The barrel has five knuckles on a 3mm pin. Leaf edges have a 1mm chamfer.

**Item:** Does each leaf have a pointed arrowhead tip at the free end?

- **reference (pass)**: Top and bottom views clearly show both leaves tapering to symmetric pointed tips at their free ends
- **variant (fail)**: Top view: each leaf tapers continuously from the barrel to a narrow flat end; no distinct triangular arrowhead point is visible at either free end
- **control (fail)**: Leaves taper continuously to a narrow end; no distinct triangular arrowhead point is visible in top/bottom views

### Hinges · `4257c1e4` · item 2
**Prompt:** A decorative strap hinge with two 150mm-long leaves featuring a pointed arrowhead tip. Each leaf is 30mm wide, 2mm thick, with four 4mm mounting holes. The barrel has five knuckles on a 3mm pin. Leaf edges have a 1mm chamfer.

**Item:** Are there exactly five knuckles on the barrel assembly?

- **reference (pass)**: [2x zoom] Looking at the barrel assembly in the center of the image, I can see the knuckle barrel where the two hinge leaves meet. The barrel assembly appears very small in the image, but at this high resolutio
- **variant (fail)**: [2x zoom] Looking at the image, the hinge barrel area shows only about 2-3 small knuckle segments visible, not 5. The barrel appears tiny with only a couple knuckles visible, and the pin protrudes far. The knuc
- **control (fail)**: [2x zoom] Looking at the image, the barrel assembly shows only a couple of small knuckle cylinders visible, not five. The barrel appears as small separate tubes — I see maybe 2-3 small cylinders, not 5 knuckles

### Generic Enclosures · `485cf1ba` · item 2
**Prompt:** A rectangular electronics enclosure: 120mm × 80mm × 50mm, 3mm walls, open top, with four M3 through-hole corner boss standoffs (5mm diameter, 8mm tall) inside

**Item:** Are there exactly 4 cylindrical standoff bosses inside the enclosure?

- **reference (pass)**: Top view shows 4 circular boss features with central through-holes at the four interior corners
- **variant (fail)**: Top view and 45° down view: only one small cylindrical boss is visible on the interior floor near one corner; the other three corners show no bosses.
- **control (fail)**: Only one cylindrical boss is visible in the 45° down view; the other three are not seen in any view

### Generic Enclosures · `485cf1ba` · item 3
**Prompt:** A rectangular electronics enclosure: 120mm × 80mm × 50mm, 3mm walls, open top, with four M3 through-hole corner boss standoffs (5mm diameter, 8mm tall) inside

**Item:** Are the standoffs located at the four interior corners?

- **reference (pass)**: Top view confirms all four bosses are positioned near the four corners of the interior
- **variant (fail)**: Top view: only one corner shows a boss (upper-left area); the remaining three interior corners have no visible standoff cylinders.
- **control (fail)**: The single visible boss sits away from the interior corner rather than in a corner position

### PCB Cases · `4d855bd1` · item 1
**Prompt:** A Jetson Nano case: rectangular box 111mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-C cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 111mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) an

**Item:** Is the case an open-top rectangular box with visibly thin walls?

- **reference (pass)**: The 45° up view clearly shows the case is open on top with interior walls visible and thin wall construction.
- **variant (fail)**: top, 45° down, and 45° up views: the case renders as a solid-looking block with no visible interior cavity, open top, or thin wall thickness.
- **control (pass)**: The case is an open-top rectangular enclosure with thin wall shells visible in the side and angled views.

### PCB Cases · `4d855bd1` · item 6
**Prompt:** A Jetson Nano case: rectangular box 111mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-C cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 111mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) an

**Item:** Is the lid oriented upside-down (flat face touching the surface)?

- **reference (pass)**: [2x zoom] Looking at the image, I can see two flat rectangular objects. The upper rectangle appears to be the lid - it's a flat, thin rectangular slab with a uniform appearance, showing its broad flat face as t
- **variant (fail)**: top and 45° down views: the lid shows a through-hole on its upward-facing surface, indicating it is face-up rather than upside-down, and the hole contradicts the requirement of a fully solid lid.
- **control (fail)**: The lid is oriented face-up, and it has a visible through-hole, contradicting the required solid, inverted lid.

### PCB Cases · `5ac6a5be` · item 2
**Prompt:** A ESP32 outdoor case: rectangular box 59mm x 36mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: micro-USB cutout (10mm x 5mm). Flat lid 59mm x 36mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facin

**Item:** Are there four cylindrical standoff posts visible inside the box at the corners?

- **reference (pass)**: Top view shows four circular standoffs at the interior corners; 45° down view confirms cylindrical posts.
- **variant (fail)**: 45° down view and top view: only one cylindrical standoff is clearly visible near one corner; the other three corner standoffs are not visible in any view
- **control (fail)**: Only one cylindrical standoff is clearly visible in the 45° down view; the other three corner standoffs are not apparent in any view

### Hinges · `5b191911` · item 3
**Prompt:** A decorative butt hinge with two 90mm x 50mm x 2.5mm leaves and five interlocking barrel knuckles on a 3.5mm pin. Each leaf end of the barrel is capped with a 7mm-diameter ball finial. Four 4mm countersunk holes per leaf.

**Item:** Is there a ball finial at each end of the barrel (top and bottom)?

- **reference (pass)**: Two ball finials are clearly visible at both ends of the barrel axis in left, right, top, bottom, and angled views
- **variant (fail)**: Front, back, left, and right views show a ball at only the bottom end of the barrel; the top end of the pin is bare with no sphere.
- **control (pass)**: Two ball finials are present, but they sit detached at the ends of the overlong pin rather than capping the barrel.

### PCB Cases · `64e0779f` · item 5
**Prompt:** A Teensy 4.1 case: rectangular box 69mm x 26mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: micro-USB cutout (10mm x 5mm), microSD slot (13mm x 3mm). Flat lid 69mm x 26mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it ups

**Item:** Are the two parts placed side-by-side on the same flat surface with a visible gap between them?

- **reference (pass)**: Both parts are clearly on the same ground plane with a visible gap between them in all views
- **variant (fail)**: Top and 45° views show the parts nearly touching, with a gap far smaller than the requested 20mm relative to the box length.
- **control (pass)**: Both parts rest on the same plane with a clear gap between them

### Gridfinity Storage · `698b0276` · item 2
**Prompt:** Create a 2x1 Gridfinity bin, 4 height units with a stacking lip, and add a small custom label holder on the front face: a 30mm x 10mm x 1mm protruding tab at the top front edge of the bin

**Item:** Is there a stacking lip visible around the top perimeter of the bin?

- **reference (pass)**: The 45° down view shows an inset lip/channel around the top perimeter, consistent with a stacking lip
- **variant (fail)**: Front, left, right, and 45° down views: the top edge is a simple rounded rim with no stepped/inset lip ring visible around the perimeter.
- **control (fail)**: The top edge appears as a simple flat rim; no distinct stepped/inset stacking lip ring is visible in any view.

### Gridfinity Storage · `8d2ec9e8` · item 1
**Prompt:** Create a 5x1 Gridfinity bin, 2 height units (shallow), divided into 5 equal compartments with labels, with a stacking lip — a shallow tray for SD cards or small electronics

**Item:** Does the bin have exactly 5 equal compartments separated by divider walls?

- **reference (pass)**: [2x zoom] I can clearly count 4 internal divider walls creating 5 equal compartments along the length of the bin. The compartments appear evenly spaced and of equal width, matching the specification.
- **variant (fail)**: 45° down view and top view: I count 4 square compartments arranged in a 2x2 grid, not 5 in a row
- **control (fail)**: Only 4 square pockets arranged in a 2x2 grid are visible; no 5-compartment elongated layout.

### Gridfinity Storage · `8d2ec9e8` · item 2
**Prompt:** Create a 5x1 Gridfinity bin, 2 height units (shallow), divided into 5 equal compartments with labels, with a stacking lip — a shallow tray for SD cards or small electronics

**Item:** Is there a raised stacking lip around the top perimeter of the bin?

- **reference (pass)**: A raised rectangular ridge is visible around the top in the 45° down view and top view, though it appears to cover only the central portion
- **variant (fail)**: 45° down view and top view: a lip-like frame exists but it is a separate open rectangle floating offset from the bin, not attached to the bin's top edge
- **control (fail)**: No raised lip is visible on the top edges in any view.

### Gridfinity Storage · `8d2ec9e8` · item 3
**Prompt:** Create a 5x1 Gridfinity bin, 2 height units (shallow), divided into 5 equal compartments with labels, with a stacking lip — a shallow tray for SD cards or small electronics

**Item:** Is the footprint 5 units wide and 1 unit deep (roughly 5× longer than it is wide)?

- **reference (pass)**: Front and top views clearly show a 5:1 aspect ratio footprint
- **variant (fail)**: Top view: the bin outline is roughly square (about 2x2 grid units), not an elongated 5:1 strip
- **control (fail)**: The footprint is approximately square (2x2 units), not elongated.

### Gridfinity Storage · `8d2ec9e8` · item 5
**Prompt:** Create a 5x1 Gridfinity bin, 2 height units (shallow), divided into 5 equal compartments with labels, with a stacking lip — a shallow tray for SD cards or small electronics

**Item:** Does each compartment have a label ledge or angled front cutout?

- **reference (pass)**: Front view shows angled cutouts along the front face; 45° down view shows stepped features consistent with label ledges in each compartment
- **variant (fail)**: 45° down view: compartment interiors show plain rectangular cavities with flat dividers and no angled front ledges
- **control (fail)**: No label ledges or angled cutouts are visible on any of the four pockets.

### PCB Cases · `91288207` · item 1
**Prompt:** A NVIDIA Jetson case: rectangular box 108mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), mini-HDMI cutout (12mm x 5mm). Flat lid 108mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side

**Item:** Is the case a rectangular open-top box (open side facing upward)?

- **reference (pass)**: The 45° up view clearly shows an open-top box with interior walls and floor visible
- **variant (fail)**: 45° down and 45° up views: the case is not a single open-top box; it is split into a base plate and a separate short wall piece, with the standoffs floating detached around it rather than inside a unified enclosure
- **control (fail)**: Walls are disconnected from the base and from each other; the enclosure does not form a continuous open-top box

### PCB Cases · `91288207` · item 2
**Prompt:** A NVIDIA Jetson case: rectangular box 108mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), mini-HDMI cutout (12mm x 5mm). Flat lid 108mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side

**Item:** Is the lid a separate flat rectangular piece placed upside-down next to the case?

- **reference (pass)**: A clearly flat rectangular slab is visible separately from the case in all views, with a visible gap between them
- **variant (fail)**: Top view and 45° down view: the lid is a thin frame with a large central opening, not a solid flat plate, and it sits on top of the case instead of upside-down beside it
- **control (pass)**: A flat rectangular plate lies beside the case with a visible gap in the 45° and top/bottom views

### PCB Cases · `91288207` · item 5
**Prompt:** A NVIDIA Jetson case: rectangular box 108mm x 88mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB-A cutout (15mm x 8mm), Ethernet cutout (17mm x 15mm), mini-HDMI cutout (12mm x 5mm). Flat lid 108mm x 88mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side

**Item:** Is there a visible gap between the two parts?

- **reference (pass)**: A clear gap is visible between the case and lid in all angled and top views
- **variant (fail)**: Top view: the lid overlaps the case footprint, so the two parts are not separated by a clear gap
- **control (pass)**: A clear gap separates the case and the lid in top, bottom, and 45° views

### Hinges · `92977023` · item 3
**Prompt:** A concealed barrel hinge: two 12mm-diameter cylindrical halves, each 40mm long, connected by an internal 4mm pivot pin. Each half has a 10mm-long flat mounting tab extending radially, 15mm wide x 2mm thick, with a single 4mm screw hole.

**Item:** Is a pivot pin visible at the axis connecting the two halves?

- **reference (pass)**: Small circular features are visible at the top and bottom ends of the barrel in the 45° views, consistent with a coaxial pivot pin protruding or flush at the ends.
- **variant (fail)**: [2x zoom] Looking at the top face: there's a small circular feature on the top face, offset from center — that appears to be a hole, not a pin filling the top. The spec says the pivot pin is coaxial, spanning f
- **control (pass)**: [2x zoom] The top face shows a circular disc at the center — that's the pivot pin end visible at the top of the bore. Yes, visible at top center of the cylinder end face. Pass.{ "pass": true, "detail": "At the

### Gridfinity Storage · `b04a8444` · item 4
**Prompt:** Create a 5x3 Gridfinity baseplate with full blocks and magnet holes in all bottom corners

**Item:** Are all 15 cells fully filled (no skeletonized or hollow cells)?

- **reference (pass)**: The baseplate appears to be a solid filled plate with no hollow or skeletonized cells; the top surface is continuous.
- **variant (fail)**: [2x zoom] The image shows a flat plate viewed from bottom — we see circular magnet holes (small circles grouped in fours per cell). Wait, the question asks if all 15 cells are fully filled (no skeletonized or h
- **control (fail)**: Cells are not delineated at all; there are no full block profiles, only isolated small bumps, so the 'full blocks' requirement is not met

### Gridfinity Storage · `b0fbb05d` · item 4
**Prompt:** Create a 3x2 Gridfinity bin, 4 height units, with weighted features in the bottom middle of each grid unit for added stability. Divide into 3 columns of compartments with labels. Include a stacking lip

**Item:** Is there a stacking lip visible around the top exterior edge of the bin?

- **reference (pass)**: [2x zoom] A continuous outward step/ledge (stacking lip) is clearly visible running around the full top exterior perimeter of the bin, shown as the lighter blue rounded-rectangle border surrounding the darker interior compartments. The lip has rounded corners and a consistent width, consistent with the specified 1.65mm radial wall width and 4.4mm lip height.
- **variant (fail)**: Top view and 45° down view: the top edge is a thin flat plate outline with no stepped ledge or outward lip around the perimeter
- **control (fail)**: The top edge is a thin flat plate with no outward step, ledge, or lip around the perimeter in any view.

### PCB Cases · `b6caba81` · item 1
**Prompt:** A Raspberry Pi 3 Model B+ case with an integrated camera platform on the lid. The base is the standard Pi 3 B+ case (90mm × 65mm × 25mm with 2mm walls, four M2.5 standoffs 5mm tall at the Pi mounting positions, port cutouts for USB-A and Ethernet on one long side). The lid (90mm × 65mm × 3mm) has a 25mm × 24mm raised platform (3mm tall) centered on top, with a 10mm × 2mm slot through the platform 

**Item:** Does the base have port cutouts (USB-A and Ethernet) on one long side?

- **reference (pass)**: Two rectangular cutouts are clearly visible on one long side wall in the 45° down view
- **variant (fail)**: 45° down view and back view: the long wall facing the lid shows a comb-like series of notches cut from the top edge rather than two distinct rectangular USB/Ethernet cutouts; the wall below the notches is solid, so the requested rectangular port openings are not present as specified
- **control (pass)**: 45° down view shows two rectangular notches in the long side wall of the base.

### Hinges · `bd78cd78` · item 6
**Prompt:** A T-hinge with one short butt leaf (50mm x 50mm x 2mm) and one long strap leaf (180mm x 35mm x 2mm) tapering to 20mm at the tip. The butt leaf has three 4mm holes; the strap has four. Five barrel knuckles with a 3mm pin.

**Item:** Is a pin visible running through all 5 knuckles?

- **reference (pass)**: A cylindrical pin/rod is visible in the 45° views running through the barrel region
- **variant (fail)**: [2x zoom] The image shows only a bare cylindrical pin floating alone — no knuckles, no leaves. So the pin cannot be seen running through knuckles because there are no knuckles at all. The feature "pin visible r
- **control (fail)**: No continuous pin through a barrel is visible; only a short stub appears at the junction.

### PCB Cases · `c7557c3a` · item 2
**Prompt:** A Wemos D1 Mini case. The board is 34mm × 25mm. The case has 2mm standoffs at the four corners; micro-USB cutout on the short end. Display as an exploded view with all parts on the same vertical axis and a 15mm gap between them.

**Item:** Is there a rectangular cutout on one of the short-end walls of the bottom shell?

- **reference (pass)**: The 45° up view shows a rectangular notch on one short-end wall of the bottom shell consistent with a micro-USB cutout.
- **variant (fail)**: Front, back, left, and right views: all four side walls of the bottom shell appear as unbroken solid rectangles with no slot or cutout visible on any short end; the 45° down view also shows no opening in either short-end wall.
- **control (fail)**: No cutout is visible on any wall of the shell in front, back, left, right, or 45° views.

### Gridfinity Storage · `c967d6df` · item 5
**Prompt:** Create a 3x2 Gridfinity bin, 6 height units, with a custom compartment layout: left half is one large compartment, right half is divided into 2 compartments stacked vertically. All compartments have scoops. Include a stacking lip

**Item:** Do all three compartments have a scoop cutout on the front face?

- **reference (pass)**: Front view shows 3 distinct scoop notches at the bottom of the front face, one per compartment
- **variant (fail)**: [2x zoom] The image shows a front view of the bin. Scoop cutouts appear as notches at the bottom of the front face — I can see two V-shaped notches at the bottom edge (at the divider positions?). Wait, the notc
- **control (fail)**: [2x zoom] The image shows a side/front view where scoop cutouts appear as notches in the bottom front edge. I can see two notches at the bottom front — but there are three compartments. The view is from the fro

### Hinges · `ce1d818d` · item 3
**Prompt:** A Soss-style invisible hinge: two rectangular mortise housings (each 15mm x 60mm x 10mm deep) connected by a multi-bar linkage consisting of three parallel 50mm-long x 5mm-wide x 2mm-thick links with 3mm pivot pins at each end. The hinge is fully concealed when closed.

**Item:** Does each link bar have cylindrical pivot pins at both ends?

- **reference (pass)**: Cylindrical pins are visible at both ends of each link bar in the isometric and side views; pin holes are also visible in the housing faces
- **variant (fail)**: Left, right, 45° down, and 45° up views: long cylindrical pins protrude prominently from the outer faces of both housings (six visible pin ends), and the pins extend far beyond the housings instead of terminating flush; the pins do not appear as short 8mm pins contained at each link bar end within the assembly envelope.
- **control (pass)**: Cylindrical pins are visible at bar ends, though they protrude excessively beyond the housings.

### PCB Cases · `def76ef7` · item 4
**Prompt:** A deep-purple BeagleBone Black enclosure. Deep purple body and lid. Standard BeagleBone Black port cutouts. Four M3 standoffs at the four mounting holes. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

**Item:** Are port cutouts present on the case walls (USB, Ethernet, power, HDMI, SD)?

- **reference (pass)**: 45° down view shows two rectangular openings on the +Y long wall (RJ45 + USB-A); front/right views show small cutouts on short walls; multiple cutouts confirmed across views, though not all five are individually distinguishable
- **variant (fail)**: Front view shows one small cutout on the short wall; right view shows one small slot; left view shows one cutout; but the long wall should have two ports (Ethernet and USB-A) and only one is visible in the left view.
- **control (pass)**: Front view shows a small slot (SD), back view shows a slot (power/USB), right view shows a low slot (micro-HDMI), and the 45° down view shows openings on the long wall; cutouts are present though some walls show fewer distinct openings than specified.

### PCB Cases · `def76ef7` · item 5
**Prompt:** A deep-purple BeagleBone Black enclosure. Deep purple body and lid. Standard BeagleBone Black port cutouts. Four M3 standoffs at the four mounting holes. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down).

**Item:** Are four cylindrical standoff posts visible inside the case body?

- **reference (pass)**: Top view shows four small circular features at the four corners of the interior, consistent with four standoff posts; only one is clearly visible in the 45° down view due to occlusion
- **variant (fail)**: Top view shows only one small circular post near a corner of the interior; 45° down view also shows a single post; the other three standoffs are not visible.
- **control (fail)**: Only one standoff post is clearly visible in the top view; the other three corner positions show no posts.

### PCB Cases · `e0febd7c` · item 3
**Prompt:** A Odroid case: rectangular box 98mm x 65mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: USB cutout (12mm x 7mm), Ethernet cutout (17mm x 15mm), HDMI cutout (16mm x 6mm). Flat lid 98mm x 65mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid

**Item:** Are there four cylindrical standoff posts visible at the interior corners of the box?

- **reference (pass)**: The top view shows four small circular posts at the four interior corners; the 45° down view shows at least one clearly.
- **variant (fail)**: [2x zoom] Only one small cylindrical post visible near one interior corner; other three corners show no posts. Fail.{ "pass": false, "detail": "Only one small cylindrical standoff post is visible near a single
- **control (pass)**: Top view shows four small circles at interior corners; one standoff visible in 45° down view

### PCB Cases · `efce5923` · item 1
**Prompt:** A LoRa32 TTGO V2.1 case. The board is 50mm × 25.5mm with a 0.96-inch OLED and SMA antenna connector. The front face has a 25mm × 13mm window for the OLED display. A 6mm circular hole on the top for the SMA connector. USB-C cutout on the bottom short end.

**Item:** Does the front face have a rectangular window cutout for the OLED display?

- **reference (pass)**: A clear rectangular through-hole is visible on the front face in the front view and 45° down view, consistent with an OLED window
- **variant (fail)**: Front view: a rectangular recessed panel is present on the front face, but it appears as a shallow pocket with a solid floor (a lens-like shading artifact) rather than a through-window; back view and 45° up view show no light passing through, so it is not a through-hole window.
- **control (pass)**: Front view shows a large rectangular through-window in the upper portion of the face.

### Hinges · `f05857ba` · item 3
**Prompt:** A concealed barrel hinge: two 12mm-diameter cylindrical halves, each 40mm long, connected by an internal 4mm pivot pin. Each half has a 10mm-long flat mounting tab extending radially, 15mm wide x 2mm thick, with a single 4mm screw hole.

**Item:** Is a pivot pin visible at the axis connecting the two halves?

- **reference (pass)**: Top and bottom views show a small circular bore/pin feature at the center of the cylinder end face, and the 45° down view shows a small circle on the top face indicating the pivot pin or bore
- **variant (fail)**: [2x zoom] The image shows a closed barrel hinge: two halves closed forming a full cylinder, tabs on both sides. The pivot pin — is it visible at the ends? The top of the cylinder shows a flat circular top face.
- **control (pass)**: Top/bottom views show a small central circle at the axis, consistent with the pivot pin inside the bore.

### PCB Cases · `f06eafd6` · item 4
**Prompt:** A Raspberry Pi Zero 2 case: rectangular box 73mm x 38mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: micro-USB cutout (10mm x 5mm). Flat lid 73mm x 38mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top

**Item:** Is there a rectangular cutout on one short side of the box?

- **reference (pass)**: A small rectangular notch is visible on the short end wall of the box in the 45° down view and right view
- **variant (fail)**: 45° down view and right view: a small notch appears at the bottom edge of the end wall, but it does not read as a clear rectangular through-cutout of the requested size on the wall face.
- **control (pass)**: A small rectangular notch is visible on the end wall in the 45° down view and right view

### PCB Cases · `f06eafd6` · item 5
**Prompt:** A Raspberry Pi Zero 2 case: rectangular box 73mm x 38mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: micro-USB cutout (10mm x 5mm). Flat lid 73mm x 38mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top

**Item:** Are the two parts separated by a visible gap on the same flat surface?

- **reference (pass)**: Both parts rest on the same Z=0 plane with a clear gap visible between them in the 45° down view
- **variant (fail)**: Top view: the lid appears to abut the box with little to no visible gap; front view shows them close together, smaller than the requested 20mm relative to the box length.
- **control (pass)**: Front view shows a gap between box and lid on the same baseline

### PCB Cases · `f4d6cff1` · item 1
**Prompt:** A ESP32 WROOM case: rectangular box 59mm x 36mm x 25mm with 2mm walls. Four M2.5 standoffs (5mm tall) inside at the corners. Port cutouts on one short side: a USB cutout (12mm x 7mm). Flat lid 59mm x 36mm x 3mm. Display both parts placed side by side on the same flat surface, separated by a 20mm gap. The case sits upright (open side up) and the lid sits next to it upside down (flat top facing down

**Item:** Does the box have a USB-shaped rectangular cutout on one short side?

- **reference (pass)**: A rectangular slot is visible on one short side of the box in the 45° down view and left view
- **variant (fail)**: Front and back views: the box appears as a thin sliver with a small white line but no clear rectangular through-opening in the short wall; no view shows a distinct USB-shaped cutout in a side wall.
- **control (fail)**: No cutout is visible on any side wall in the front, back, or angled views.

### PCB Cases · `f6cf328b` · item 5
**Prompt:** A Raspberry Pi Zero 2 W case with outer dimensions 74mm x 36mm x 14mm and 2mm walls. The base holds the board on four 2mm-tall standoffs. Port cutouts on one short edge: two micro-USB openings (10mm x 5mm each, 3mm apart). On one long edge: a mini-HDMI opening (12mm x 5mm, centered). On the opposite long edge: a camera ribbon slot (22mm x 3mm, centered). Display both parts placed side by side on t

**Item:** Is there a wide horizontal slot visible on one long wall of the base (camera ribbon)?

- **reference (pass)**: 45° down view shows a wide horizontal slot on one long wall of the base, consistent with the camera ribbon cutout; also suggested by the left/right side views showing openings
- **variant (fail)**: Right view and other views: no horizontal slot is visible on the long wall of the base; the wall appears solid.
- **control (pass)**: Left view shows a wide horizontal slot on the long wall; right view shows the opposite long wall without a large slot.

## either uncertain — 0 items

