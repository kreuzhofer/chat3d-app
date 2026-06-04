# Research Missing Knowledge (sub-skill of improve-category)

Use when a category is **hard** (approval rate stays <70% after Phase 2 re-evals, or saturation signal hits in Phase 5 with no sub-skills spawned) **and** the gap analysis suggests prompts reference real-world entities or build123d idioms that the KB cannot back up. Adds reference entries to the knowledge base before another regen round.

> Loaded by `SKILL.md` Phase 3.5. Do not invoke standalone — depends on the auth token and `$categoryId` already resolved by the orchestrator.

## When this sub-skill applies

Trigger this sub-skill in the orchestrator when **any** of the following are true after Phase 1–3:

- Average `bestScore` ≥ 6 but approval rate <70% — agent gets close but loses on details (often dimensions, port positions, idiom)
- A pending prompt cites a specific named entity (a board model, connector, fastener, library part) and the failing example's eval issues mention "wrong dimensions", "incorrect position", or "hallucinated"
- Multiple pending prompts share a recurring technique that has zero or one matching entry in the `Build123d ReadTheDocs` / GitHub Examples / GitHub Tests sources (idiom gap, not domain gap)

Do **not** trigger when:
- Average score is already <5 — that's a composition / agent capability problem, not a KB problem; jump to `simplify-hard-prompts.md` instead
- All gap entities are already present in the KB (verify before researching — see "Detect KB gaps" below)

## Detect KB gaps

1. **Extract candidate entities** from the failing pending prompts. Look for:
   - Board model names (regex roughly `(Raspberry Pi|Arduino|Teensy|ESP32|Wemos|Orange Pi|Jetson|Banana Pi|BeagleBone|STM32|Pico|Feather|XIAO|M5Stack|LILYGO) [\w \-]+`)
   - Connector / port keywords (USB-C, USB-A, HDMI, micro-HDMI, mini-HDMI, microSD, RJ45, GPIO header, JST-*, barrel jack, audio jack)
   - Fastener keywords (M1.6, M2, M2.5, M3, M4 + screw / standoff / heat-set insert)
   - Library parts (gridfinity, bd_warehouse parts: bearing, gear, sprocket, fastener, thread, pipe, flange)
   - Build123d techniques (offset, shell, hollow, exploded view, multi-part display, assembly, joint)

2. **For each candidate, query the KB:**
   ```bash
   TOKEN=$(cat /tmp/chat3d-token.txt)
   curl -s "http://localhost/api/admin/knowledge?search=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ENTITY")&limit=5" \
     -H "Authorization: Bearer $TOKEN" \
     | python3 -c "import sys,json; d=json.load(sys.stdin); items=d.get('items') or d.get('entries') or (d if isinstance(d,list) else []); print(f'{len(items)} hits'); [print(f\"  - {it.get(\\\"title\\\")}\") for it in items[:3]]"
   ```

3. **Classify each candidate as:**
   - `present` — ≥1 KB entry whose title or content includes the entity → not a gap, skip
   - `partial` — title hits but content doesn't include the specific spec the prompt needs (e.g., board entry exists but lacks port-edge offset) → upgrade the existing entry instead of creating a new one
   - `missing` — zero hits → fully research and add

4. **Report the gap table** before going to research:
   ```
   | Entity                  | Status   | Mentioned in N prompts |
   |-------------------------|----------|------------------------|
   | Raspberry Pi 5 PoE+ HAT | missing  | 2                      |
   | M2.5 heat-set insert    | partial  | 6                      |
   | "exploded view" idiom   | missing  | 11                     |
   ```

Cap research at the top 5 highest-impact gaps per round (by `mentioned in N prompts`). Adding 20 entries at once means embedding everything and burns time.

## Research a domain entity (boards, connectors, fasteners)

For each `missing` or `partial` domain entity:

1. **Find an authoritative source.** Priority order:
   1. Vendor official datasheet PDF (Raspberry Pi Foundation, Espressif, Adafruit, Sparkfun, NVIDIA, Seeed)
   2. Vendor product page with mechanical drawing
   3. Wikipedia infobox / mechanical drawing
   4. Adafruit / Sparkfun product page (well-maintained for many third-party boards)
   5. Community reference (Osban, GitHub gist with a CAD model)

2. **Use WebSearch first** to find the source — `"<entity name> mechanical drawing dimensions site:<vendor>.com OR site:adafruit.com OR site:wikipedia.org"`.

3. **Use WebFetch on the chosen URL** with a prompt like:
   > Extract a mechanical dimensions reference for [entity]. I need: overall length/width/height in mm, mounting hole positions (X/Y/diameter, origin = bottom-left of board), port positions and dimensions (which edge, distance from nearest corner, cutout size), header positions if any. Output as a markdown table. Cite the source URL.

4. **Cross-check** at least one number against a second source. If they disagree, prefer the vendor datasheet and flag the disagreement in the entry's description.

5. **Compose the entry** using the same format as existing dev-board entries (see `Development Board Datasheets` source):
   ```markdown
   # <Entity Name> — Mechanical Dimensions

   ## Board Dimensions
   | Parameter | Value (mm) | Notes |
   |-----------|-----------|-------|

   ## Mounting Holes
   | Hole | X (mm) | Y (mm) | Diameter (mm) | Notes |

   ## Port Locations
   | Port | Edge | Distance from corner (mm) | Cutout (W×H mm) | Notes |

   ## Source
   - <vendor URL> (accessed YYYY-MM-DD)
   ```

6. **POST to the KB:**
   ```bash
   curl -s -X POST "http://localhost/api/admin/knowledge/reference" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d @- <<JSON
   {
     "sourceId": "<source id from table below>",
     "sourceUrl": "<vendor URL>",
     "title": "<Entity> Mechanical Dimensions",
     "content": "<the markdown body above>",
     "description": "Board dimensions, mounting holes, port locations for the <Entity> used in 3D-printed enclosure design"
   }
   JSON
   ```

   **Reference source IDs** (check `/api/admin/knowledge/sources` for current values):
   | Source name | ID | Use for |
   |-------------|------|---------|
   | Development Board Datasheets | `9e898d2c-6707-4bc6-beac-4a435c8a2a3b` | Boards, modules, HATs |
   | Connector & Fastener Dimensions | `9d6d30d2-dae6-4afc-b619-e25ca1e6079e` | Connectors, fasteners |
   | 3D Printing Design Guidelines | `1e64abf6-cc21-43cf-9e08-58a462350269` | Tolerances, wall rules |
   | Osban RPi Mounting Dimensions | `e16218c6-15f5-44c7-a397-afabdb684bbd` | RPi-family mount-hole specs |

## Research a build123d idiom

For `idiom` gaps (recurring technique with no KB example), the path is different:

1. **Search build123d's own corpora** before writing anything:
   ```bash
   curl -s "http://localhost/api/admin/knowledge?search=<technique-keyword>&limit=10" -H "Authorization: Bearer $TOKEN"
   ```
   The KB already indexes `Build123d ReadTheDocs`, GitHub Examples, GitHub Tests, and Cookbook. If a working example exists in any of those, the gap is the **agent's retrieval**, not the data.

2. If nothing relevant is indexed, search build123d sources externally:
   - `gh search code --repo gumyr/build123d --extension py "<technique>"`
   - `gh search code --repo gumyr/bd_warehouse --extension py "<technique>"`
   - WebSearch `"build123d <technique> example"` filtered to `site:github.com OR site:build123d.readthedocs.io`

3. When you find one, add it as a **manual entry** under `Build123d Cookbook` source (entry already exists in the sources list), not as a reference entry — code-style entries get validated and embedded as code.

   **Anti-drift requirements** (same rules as `research-from-failures.md`): observed failure on 2026-06-04 — cookbook entries carrying concrete connector dimensions (USB-A 13.5mm, etc.) pulled the agent's attention away from prompt-spec dimensions, causing a regression from score 7 → 3. Therefore:
   - Use **generic parameter names** (`port_w`, `board_w`, `wall`) — never component-specific names (`usb_c_w`)
   - Mark every concrete number as illustrative: `port_w = 13.5  # example value — replace with prompt spec`
   - Add a top-of-parameters comment: `# Substitute the prompt's own dimensions when using this idiom.`
   - Keep connector/fastener dimensions OUT of idiom entries (they're already in the `Connector & Fastener Dimensions` reference source, pre-retrieved by keyword). Idiom entries demonstrate STRUCTURE and ARITHMETIC only
   - **Description must end with the mandatory anti-drift guard sentence (verbatim):** *"Use the idiom and arithmetic shown; substitute the prompt's own dimensions throughout — concrete numbers below are illustrative, not normative."*

   ```bash
   curl -s -X POST "http://localhost/api/admin/knowledge/entries" \
     -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d @- <<JSON
   {
     "sourceId": "<Cookbook source id>",
     "title": "<technique> — minimal working example",
     "code": "<python code, <60 lines, executable, generic parameter names, inline 'example value' comments>",
     "description": "Idiom: <one-line description>. Demonstrates: <bullet list of techniques>. Use the idiom and arithmetic shown; substitute the prompt's own dimensions throughout — concrete numbers below are illustrative, not normative."
   }
   JSON
   ```

4. **Validate the entry** (the endpoint runs syntax + build123d execution check):
   ```bash
   curl -s -X POST "http://localhost/api/admin/knowledge/validate" -H "Authorization: Bearer $TOKEN"
   ```

## After research

1. **Re-embed the new entries** so they're available for RAG:
   ```bash
   curl -s -X POST "http://localhost/api/admin/knowledge/embed" -H "Authorization: Bearer $TOKEN"
   ```
   Poll the returned `jobId` (same `/api/admin/workbench/jobs/:jobId` pattern). Usually <60s for a handful of new entries.

2. **Spot-check retrieval** on one failing prompt:
   ```bash
   curl -s "http://localhost/api/admin/rag-hit-rate?prompt=$(urlencode '<prompt text>')" -H "Authorization: Bearer $TOKEN"
   ```
   The new entry should appear in the top-5 hits. If it doesn't, the title/description likely needs more keywords matching the prompt's wording.

3. **Hand control back to the orchestrator** which will run Phase 4 (seed prompts targeting the same patterns) and Phase 5 (regen). The new KB entries should land in the agent's context on the next generation.

## What NOT to do

- **Do not invent dimensions.** If you can't find an authoritative source within ~3 search/fetch attempts, leave the entity as an unresolved gap and pass it to `simplify-hard-prompts.md` — the prompt may need to be rewritten to use a board that *is* in the KB.
- **Do not copy entire datasheet pages.** Reference entries are mechanical-dimension summaries, not full datasheets. Keep each entry <300 lines of markdown.
- **Do not skip the source URL.** Every reference entry must cite its source — both for auditability and so future research knows where to refresh.
- **Do not crawl entries the existing crawlers already cover.** If a build123d example exists in `gumyr/build123d/examples/`, the crawler already indexed it. Trigger a re-crawl via `POST /api/admin/knowledge/sources/:id/crawl` instead of duplicating manually.
- **Do not run this in a loop.** One pass per orchestrator round. If the gap list is huge, take the top 5 and move on — the saturation signal will tell you if the round helped.

## Stop conditions for this sub-skill

Hand back to the orchestrator when:
1. All top-N gaps are addressed (entry POSTed and embed completed), OR
2. Authoritative sources cannot be found for the remaining gaps within ~3 attempts each → defer the gap to `simplify-hard-prompts.md`, OR
3. More than 5 entries have been added this round — cap hit; let the regen confirm whether it helped before adding more.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Adding a board entry but the prompt also fails because it references an unfamiliar HAT | Research the HAT *and* the base board; HATs stack and their footprint differs |
| Reference entry title doesn't match prompt wording (e.g., title `RPi 4B` vs prompt `Raspberry Pi 4 Model B`) | Use the full canonical name in the title; aliases go in the description body |
| Forgetting to re-embed after POSTing | The entry exists in the DB but never enters RAG until `POST /knowledge/embed` runs |
| Posting prose instead of structured tables | The agent extracts dimensions by pattern-matching tables; flowing prose retrieves but doesn't ground numbers reliably |
| Treating every low-score prompt as a KB problem | If the spec already cites correct dimensions and the agent still fails, the gap is composition or VLM eval — not KB. Use `simplify-hard-prompts.md` |
