#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost"
TOKEN_FILE="/tmp/chat3d-token.txt"

# Refresh token
TOKEN=$(curl -sf "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@chat3d.local","password":"change-admin-password"}' \
  | jq -r '.token')
echo "$TOKEN" > "$TOKEN_FILE"
echo "Token refreshed."

AUTH="Authorization: Bearer $TOKEN"

# Create Hinges category
echo "Creating Hinges category..."
CAT_ID=$(curl -sf "$BASE/api/admin/workbench/categories" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Hinges",
    "rank": 13,
    "complexity": 7,
    "description": "Hinge mechanisms including butt, strap, barrel, piano, pivot, butterfly, concealed, and print-in-place designs."
  }' | jq -r '.id')

echo "Created category: $CAT_ID"

# Insert all 28 prompts
echo "Inserting 28 prompts..."
curl -sf "$BASE/api/admin/workbench/categories/$CAT_ID/prompts" \
  -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "$(cat <<'ENDJSON'
{
  "prompts": [
    "A two-leaf butt hinge: each leaf is 75mm tall x 50mm wide x 2mm thick with three countersunk 4mm mounting holes. Five interlocking knuckles along the 75mm barrel, connected by a 3mm-diameter removable pin.",
    "A heavy-duty butt hinge with two 100mm x 60mm x 3mm leaves. The barrel has seven interlocking knuckles with a 4mm pin. Each leaf has four 5mm countersunk mounting holes evenly spaced.",
    "A miniature butt hinge for cabinet doors: two 40mm x 30mm x 1.5mm leaves, each with two 3mm mounting holes. Three interlocking knuckles along the barrel with a 2mm pin.",
    "A decorative butt hinge with two 90mm x 50mm x 2.5mm leaves and five interlocking barrel knuckles on a 3.5mm pin. Each leaf end of the barrel is capped with a 7mm-diameter ball finial. Four 4mm countersunk holes per leaf.",
    "A long strap hinge: two tapered leaves, each 200mm long tapering from 40mm wide at the barrel end to 20mm wide at the tip, 2.5mm thick. Five 4mm mounting holes per leaf. Barrel with five knuckles and a 3.5mm pin.",
    "A T-hinge with one short butt leaf (50mm x 50mm x 2mm) and one long strap leaf (180mm x 35mm x 2mm) tapering to 20mm at the tip. The butt leaf has three 4mm holes; the strap has four. Five barrel knuckles with a 3mm pin.",
    "A decorative strap hinge with two 150mm-long leaves featuring a pointed arrowhead tip. Each leaf is 30mm wide, 2mm thick, with four 4mm mounting holes. The barrel has five knuckles on a 3mm pin. Leaf edges have a 1mm chamfer.",
    "A heavy gate strap hinge: two 250mm x 45mm x 4mm flat leaves. The barrel has seven interlocking knuckles with a 5mm pin. Six 6mm countersunk holes per leaf, evenly spaced along the length.",
    "A concealed barrel hinge: two 12mm-diameter cylindrical halves, each 40mm long, connected by an internal 4mm pivot pin. Each half has a 10mm-long flat mounting tab extending radially, 15mm wide x 2mm thick, with a single 4mm screw hole.",
    "A weld-on barrel hinge consisting of two cylindrical knuckles, each 10mm outer diameter, 30mm long, with 1.5mm wall thickness. A 3mm pin connects them. No mounting holes — the flat weld face runs the full 30mm length on each barrel.",
    "A single-axis pivot hinge with a top-mount plate: a 50mm x 50mm x 3mm square top plate with four 4mm corner mounting holes and a 6mm-diameter central pivot pin extending 15mm downward. A matching bottom plate receives the pin in a 6.2mm bore.",
    "An offset pivot hinge: a 60mm x 25mm x 3mm mounting plate with two 4mm holes and a 6mm pivot post offset 15mm from the plate edge, rising 20mm tall. A matching pivot socket plate (60mm x 25mm x 3mm) with a 6.2mm bore receives the post.",
    "A 200mm segment of a continuous piano hinge: two 25mm-wide leaves, 1mm thick, joined by interlocking knuckles along the full 200mm length (knuckle pitch 10mm). A 2mm-diameter continuous pin. Mounting holes every 25mm, 3mm diameter.",
    "A 150mm continuous piano hinge segment with two 40mm-wide leaves, 1.5mm thick, joined by alternating 8mm-pitch knuckles on a 2.5mm pin. 3.5mm mounting holes spaced every 30mm along each leaf.",
    "A short piano hinge, 80mm long: two 20mm-wide x 1mm-thick leaves with alternating 10mm-pitch knuckles on a 2mm pin. Three 3mm mounting holes per leaf.",
    "A butterfly hinge with two symmetrical wing-shaped leaves, each 70mm tall x 40mm wide x 2mm thick. The leaf profile is a stylized butterfly wing with a concave waist narrowing to 15mm near the barrel. Three 3.5mm mounting holes per leaf. Five barrel knuckles on a 3mm pin.",
    "A butt hinge with an external coil spring: two 80mm x 45mm x 2.5mm leaves, five barrel knuckles on a 3.5mm pin. A 12mm-diameter helical coil spring (wire diameter 1.5mm, 6 turns) wraps around the barrel between the middle knuckles.",
    "A flush-mount (mortise) hinge: two 60mm x 40mm x 1.5mm leaves where one leaf nests inside the other when closed, so the total closed thickness is 1.5mm. Five barrel knuckles on a 2.5mm pin. Each leaf has three 3.5mm countersunk holes.",
    "A parliament hinge (cranked): two 100mm-tall leaves with an L-shaped profile. Each leaf has a 30mm-wide mounting flange and a 25mm offset arm leading to the barrel. The offset allows 180-degree opening. Four 4mm mounting holes per flange. Five barrel knuckles on a 3.5mm pin.",
    "A European-style concealed cup hinge: a 35mm-diameter x 12mm-deep cylindrical cup with a 2mm-wide mounting flange rim. A single arm extends 55mm from the cup, 12mm wide x 10mm tall, ending in a flat 40mm x 12mm mounting plate with two elongated 4mm x 8mm adjustment slots.",
    "A Soss-style invisible hinge: two rectangular mortise housings (each 15mm x 60mm x 10mm deep) connected by a multi-bar linkage consisting of three parallel 50mm-long x 5mm-wide x 2mm-thick links with 3mm pivot pins at each end. The hinge is fully concealed when closed.",
    "A concealed pivot hinge with two rectangular blocks, each 20mm x 20mm x 35mm tall. The upper block has a 5mm pivot pin protruding 8mm downward. The lower block has a matching 5.2mm bore, 10mm deep. Each block has two 4mm lateral mounting holes.",
    "A print-in-place butt hinge that prints as one piece: two 60mm x 40mm x 2mm leaves connected by five interlocking knuckles with a 0.3mm clearance gap between the knuckle cylinders. Knuckle outer diameter 6mm, inner bore 3mm. Three 3.5mm mounting holes per leaf.",
    "A print-in-place barrel hinge with two 50mm x 35mm x 2mm leaves. The barrel consists of three interlocking segments (outer diameter 8mm) with 0.4mm clearance between segments. No separate pin needed — the captured geometry allows rotation after printing. Two 4mm holes per leaf.",
    "A living hinge: a flat 80mm x 50mm x 3mm rectangular plate with a thin 0.4mm-thick x 2mm-wide flexible bridge running across the full 50mm width at the center. The bridge connects two rigid halves, each 39mm long. Four 3.5mm mounting holes, two per half.",
    "A snap-fit print-in-place hinge with two 55mm x 40mm x 2.5mm leaves. One leaf has three 5mm-diameter ball studs along its edge; the other has matching snap-fit sockets (5.2mm inner diameter with a 4mm entry slit). 0.3mm clearance for rotation. Three 3.5mm mounting holes per leaf.",
    "A friction torque hinge: two 70mm x 40mm x 2.5mm leaves connected by a barrel joint with a split-clamp friction mechanism. The barrel outer diameter is 10mm with a 1mm-wide longitudinal slit. A 4mm clamping screw passes through a lug on one knuckle to adjust friction. Four 4mm mounting holes per leaf.",
    "A double-action saloon-door hinge that allows 180-degree swing in both directions: two 90mm x 45mm x 2.5mm leaves connected by a central barrel assembly with two independent pivot axes offset by 8mm. Each pivot has a 3.5mm pin. The assembly allows the leaves to swing past center in either direction. Four 4mm holes per leaf."
  ]
}
ENDJSON
)"

echo ""
echo "Done! Verifying..."

# Verify
curl -sf "$BASE/api/admin/workbench/categories" -H "$AUTH" | jq '.[] | select(.name == "Hinges") | {name, rank, promptCount}'
