import { IPromptExample } from "./OpenScadExamples";

export const StaticDocuments: IPromptExample[] = [
    {
        prompt: "find me all the details about gridfinity, all specs, design tips, etc. that would be helpful for designing gridfinity parts",
        code: `
Gridfinity is a modular organization system based on a 42x42x7mm grid format. Here are the key specifications and design details:

## Core Specifications
The basic system consists of two main components: baseplates and blocks. Blocks are designed to be 41.5mm square to allow tolerance when fitting into baseplates[1][4].

## Block Design Specifications
**Height Calculations**:
- Base height formula: X units × 7mm + lip height
- Standard lip height: 4.4mm
- Rounded lip height: 3.69mm
- Example: A 3-unit block with standard lip = 25.4mm total height[4]

**Component Features**:
- Z-shaped socket design for secure fitting
- Optional label sections for organization
- Magnet holes: 6mm diameter, 2mm thickness
- Four corner magnet positions per unit for rotation compatibility[1]

## Design Tips

**Printing Parameters**:
- Use larger nozzle sizes for faster printing
- Pay attention to top and bottom layers for flat surfaces
- Consider higher layer heights (0.4mm) for efficiency[2]

**Design Considerations**:
- Include tolerance gaps in dimensions
- Optional features:
  - M3 screw holes
  - Heat set insert compatibility (4.2mm diameter)
  - Label sections for organization[7]

## Customization Guidelines

**Block Creation Process**:
1. Start with base specifications (41.5mm square)
2. Create cutout shapes for specific tools
3. Use boolean operations to subtract shapes from base block
4. Add tolerance for easy tool removal[2]

**Implementation Tips**:
- Start without magnets initially
- Use lightweight base prints for initial layout testing[5]
- Consider rounded stacking lips for easier printing
- Maintain standard dimensions for compatibility[7]

Citations:
[1] https://github.com/gridfinity-unofficial/specification
[2] https://www.youtube.com/watch?v=KtbKwAuwv9s
[3] https://www.youtube.com/watch?v=eTieetk2dSw
[4] https://www.reddit.com/r/gridfinity/comments/132cjx9/wrapping_my_head_around_design_specifications/
[5] https://www.reddit.com/r/gridfinity/comments/1decthy/tips_and_tricks/
[6] https://latitude.so/blog/the-ultimate-guide-to-llm-feature-development/
[7] https://github.com/Stu142/Gridfinity-Documentation/tree/main
[8] https://www.youtube.com/watch?v=TvIvoY013xQ
[9] https://arxiv.org/html/2408.13296v1
[10] https://www.printables.com/model/417152-gridfinity-specification/comments?lang=de
        `
    },
    {
        prompt: "find me all the details about ikea kallax, all specs, design tips, etc. that would be helpful to design ikea kallax shelves, add-ons, drawers, etc.",
        code: `
The IKEA KALLAX is a versatile storage system that can be customized in multiple ways. Here's a comprehensive overview:

## Core Features
- Can be placed standing, lying down, or wall-mounted[4]
- Features smooth surfaces and rounded corners for aesthetic appeal[5]
- Must be fixed to the wall with included wall fasteners for safety[5]
- Available in various sizes and colors[4]

## Specifications

**Standard Unit Measurements**
- Width: 76.5 cm
- Depth: 39 cm
- Height: 76.5 cm (for square unit)[12]
- Maximum load per shelf: 13 kg[12]
- Maximum wall cabinet load: 20 kg[12]

## Customization Options

**Available Inserts**
- Drawer inserts with 2 drawers (33x33 cm)[3]
- Door inserts (13x13 inches)[4]
- Storage boxes and baskets[4]
- Magazine files[4]
- LED lighting options[4]

**Design Enhancement Tips**
- Add feet or wheels to gain 4-6" extra storage space and mobility[8]
- Create custom looks using decorative panels[2]
- Mix open shelves with closed storage using drawer inserts and boxes[6]
- Use as a room divider with finished back panels[3]

## Maintenance
- Clean with a damp cloth using mild cleaner[3]
- Wipe dry with clean cloth[3]

## Construction Details
**Materials**
- Made from particleboard and fibreboard
- Features honeycomb structure paper filling (100% recycled)
- Finished with acrylic paint and plastic edging[5]

## Storage Solutions
- Can function as a shelving unit, sideboard, or room divider[5]
- Perfect for displaying collections or storing items behind closed doors[6]
- Customizable with hanging hammocks, shelf dividers, and wire-basket inserts[6]

The KALLAX system prioritizes quality with attention to detail, ensuring perfectly aligned shelves and a uniform appearance[12].

Citations:
[1] https://www.ikea.com/us/en/p/kallax-shelf-unit-white-00275848/
[2] https://ikeahackers.net/2024/02/ikea-kallax-hacks.html
[3] https://www.ikea.com/de/en/p/kallax-insert-with-2-drawers-wave-shaped-pale-turquoise-60496743/
[4] https://www.ikea.com/us/en/cat/kallax-series-27534/
[5] https://www.ikea.com/de/en/p/kallax-shelving-unit-white-80275887/
[6] https://www.ikea.com/kr/en/ideas/home-visit-make-your-kallax-unit-truly-yours-pub67d7d0e8/
[7] https://www.ikea.com/de/en/p/kallax-insert-with-2-drawers-wave-shaped-white-90508508/
[8] https://thehomesihavemade.com/how-to-add-feet-to-an-ikea-kallax/
[9] https://www.ikea.com/us/en/p/kallax-shelf-unit-white-30275861/
[10] https://www.ikea.com/es/en/ideas/home-visit-make-your-kallax-unit-truly-yours-pub67d7d0e8/
[11] https://www.ikea.com/gb/en/p/kallax-insert-with-2-drawers-white-70286645/
[12] https://www.ikea.com/de/en/p/kallax-shelving-unit-white-20275814/
        `
    },
    {
        prompt: "if you had to instruct a blind CAD model designer to create gridinity parts, how would you describe the gridfinity specification to them so they can design baseplates and gridinity parts and other add-ons with a CAD program.",
        code: `
Let me provide a tactile-focused description of Gridfinity specifications that would work well with accessible CAD programs.

## Base Unit Dimensions
The fundamental unit is a square block with these measurements:
- Base square: 41.5mm × 41.5mm for blocks (to allow tolerance)
- Grid spacing: 42mm × 42mm for baseplates
- Height unit: 7mm per vertical unit

## Tactile Reference Points
**Socket Design**:
- Create a Z-shaped profile along edges
- Bottom lip extends inward by 0.25mm
- Upper lip creates a vertical stop for secure placement

**Magnet Placement**:
- Four circular holes in corners
- Diameter: 6mm
- Depth: 2mm
- Position: Centered at corners, 2mm from bottom

## Height Calculations
**Block Heights**:
1. Start with base height: (number of units × 7mm)
2. Add lip height: 4.4mm for standard lip
3. Example: 3-unit block = (3 × 7mm) + 4.4mm = 25.4mm total

## Programming Approach
Using a programmatic CAD approach (like OpenSCAD)[4]:
1. Define base unit as primary variable
2. Create functions for height calculations
3. Use boolean operations for cutouts
4. Implement arrays for multiple units

## Accessibility Considerations
**Verification Methods**:
- Use 2.5D tactile displays for prototype verification[4]
- Create small test prints for physical validation
- Implement grid-based navigation in CAD software[2]

This specification allows for systematic creation of Gridfinity-compatible components while focusing on measurable, programmatic parameters that can be input through accessible CAD interfaces[4][6].

Citations:
[1] https://notes.augmentedapprentice.com/Project-Ideas/Gridfinity-2.0-Project-Management-Extension
[2] https://research.gold.ac.uk/id/eprint/30382/1/COM_thesis_FernandoS_2021.pdf
[3] https://github.com/gridfinity-unofficial/specification
[4] https://shape.stanford.edu/research/shapeCAD/
[5] https://arxiv.org/html/2403.08716v1
[6] https://www.techbriefs.com/component/content/article/35805-5ws-of-3d-modeling-for-the-visually-impaired
[7] https://www.printables.com/de/model/280602-gridfinity-2x2-tactile-spiral-vase-pen-cup
[8] https://www.youtube.com/watch?v=AAcyj_pg5c0
        `
    },
    {
        prompt: "if you had to design gridfinity parts in openscad as a blind designer, how would you describe the process of designing the parts without actually writing the code but really just focusing on the details a cad designer using openscad had to follow to be successful?",
        code: `
Let me describe a systematic process for designing Gridfinity parts in OpenSCAD that focuses on the logical flow and spatial relationships a blind designer would need to consider.

## Base Structure Approach
1. Start with the fundamental unit measurements:
- Define base square of 41.5mm × 41.5mm as your primary building block
- Work in discrete height units of 7mm
- Add standard lip height of 4.4mm to all vertical calculations

## Sequential Design Process

**Foundation Layer**:
- Begin with a flat base plate
- Position magnet holes at corners: 6mm diameter, 2mm deep
- Add screw holes if needed for mounting

**Wall Construction**:
- Extrude walls vertically from base
- Create Z-profile lip around top edge
- Include 0.25mm tolerance gaps between components

**Feature Implementation**:
- Work in a grid-based coordinate system
- Build features from bottom to top
- Use boolean operations (difference, union) for cutouts
- Implement sequential bridging for overhangs

## Verification Methods

**Quality Control**:
- Use 2.5D tactile display for shape verification[2]
- Test each feature individually before combining
- Verify measurements using programmatic checks
- Create small test prints for physical validation

## Design Tips
- Start with simple shapes and add complexity gradually
- Use variables for all measurements to maintain proportions
- Implement modular components that can be reused
- Test structural integrity through boolean operations
- Consider printing orientation during design phase

This process allows blind designers to create consistent, functional Gridfinity components while maintaining system compatibility and structural integrity[4][6].

Citations:
[1] https://docs.ostat.com/docs/openscad/gridfinity-extended/basic-cup/
[2] https://www.bricsys.com/pt-pt/blog/a-cad-display-for-blind-and-visually-impaired-users
[3] https://github.com/ostat/gridfinity_extended_openscad/
[4] https://research.gold.ac.uk/id/eprint/30382/1/COM_thesis_FernandoS_2021.pdf
[5] https://www.reddit.com/r/gridfinity/comments/1bixs7r/gridfinity_openscad_how_to/
[6] https://shape.stanford.edu/research/shapeCAD/
[7] https://docs.ostat.com/docs/openscad/gridfinity-extended
[8] https://www.youtube.com/watch?v=AAcyj_pg5c0
        `
    }
];