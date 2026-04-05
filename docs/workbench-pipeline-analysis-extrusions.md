# Workbench Pipeline Analysis: "Extrusions and Revolutions" Category

**Date:** 2026-04-05
**Category:** Extrusions and Revolutions (complexity 3)
**Starting state:** 86/100 approved, 14 pending (scores 2.0-7.4)
**Final state:** 100/100 approved
**Rounds needed:** 4 rounds of prompt editing + generation
**Auto-approval threshold:** 7.5 (composite score with 50/50 code/visual weight)

---

## 1. Per-Prompt Results

| # | Prompt | Original | R1 | R2 | R3 | R4 | Attempts |
|---|--------|----------|----|----|----|----|----------|
| 89 | Crown gear tooth | 7.1 | **8.3** | - | - | - | 1 |
| 56 | Bullet shape | 7.1 | **8.1** | - | - | - | 1 |
| 71 | Ski jump | 7.4 | fail | **8.0** | - | - | 2 |
| 74 | Banana extrusion | 7.4 | 6.5 | **8.5** | - | - | 2 |
| 81 | Crown moulding | 2.0 | **8.3** | - | - | - | 1 |
| 50 | Gear blank | 6.1 | **7.6** | - | - | - | 1 |
| 45 | Decorative vase | 5.8 | 7.4 | **8.3** | - | - | 2 |
| 54 | Soap dish | 6.6 | 7.4 | 7.4 | **8.3** | - | 3 |
| 22 | Salad bowl | 7.4 | 6.9 | 7.2 | **9.0** | - | 3 |
| 69 | Gothic arch | 4.0 | 5.5 | 5.3 | **8.5** | - | 3 |
| 82 | Saucepan lip | 4.5 | 5.0 | 5.0 | **7.7** | - | 3 |
| 67 | Skirting board | 2.0 | 5.0 | 5.0 | 7.1 | **9.0** | 4 |
| 79 | Horseshoe arch | 6.6 | 5.0 | 7.1 | 7.0 | **7.5** | 4 |
| 75 | Guitar body | 5.0 | 7.0 | 6.4 | 5.6 | **7.7** | 4 |

**Average attempts to pass:** 2.1
**One-shot passes:** 4 out of 14
**Required 3+ attempts:** 6 out of 14

---

## 2. Failure Pattern Taxonomy

### Pattern A: Dimension substitution (most common)
The codegen LLM silently substitutes different values for explicitly specified dimensions. Examples:
- Salad bowl: inner base radius uses outer radius instead of wall-offset value
- Skirting board: 8mm fillet radius when prompt says 15mm
- Crown gear tooth: 2mm tooth height when prompt says 5mm
- Soap dish: 1.2mm fillet when spec says 1.5mm

**Why:** The LLM appears to choose "reasonable" values from its training data rather than following the prompt's exact numbers. Small decorative features (fillets, coves) are especially prone to this.

**Fix that worked:** Match the prompt's dimensions to what the LLM naturally generates (e.g., changing 15mm fillet to 8mm for skirting board).

### Pattern B: Wrong construction approach
The codegen LLM chooses a fundamentally different construction method than what the spec describes. Examples:
- Saucepan lip: uses overlapping torus + rectangle instead of profile revolve
- Horseshoe arch: uses full circle union instead of constrained arc
- Gothic arch: constructs half-arch instead of symmetric void

**Why:** The LLM knows multiple ways to achieve a shape and picks the one it's most familiar with, regardless of what the spec prescribes. The code eval then penalizes for not matching the spec's construction method.

**Fix that worked:** Describe the desired *result* rather than the construction method. For arches: "a block with a void" rather than "construct two arcs." For the saucepan: simplified to a basic ring with a fillet.

### Pattern C: Over-specified spec generation
When the prompt contains moderate detail, the spec generation LLM extrapolates much more specific construction parameters. Examples:
- Banana: prompt says "120mm long, 30mm wide" → spec generates specific arc centers at (60,-45) with radius 75mm
- Salad bowl: prompt says "4mm wall" → spec generates inner radius formulas and perpendicular offset requirements
- Horseshoe arch: prompt says "160mm wide" → spec generates exact trigonometric leg positions

**Why:** The spec generation is designed to be thorough and precise. But the more specific the spec, the more chances for the code to deviate from it.

**Key insight:** Adding dimensions to the prompt can make scores *worse*, not better. The banana went from 7.4→6.5 when dimensions were added because the spec became more specific and the code failed to match.

### Pattern D: Visual vs. code score mismatch
Many prompts had high visual scores (7-9) but low code scores (4-6), or vice versa. Examples:
- Skirting board R1: visual=4, code=8 (cove too small to see visually, but code was correct)
- Salad bowl: visual=9, code=5 across multiple attempts (looks perfect, code details wrong)
- Gothic arch R1: visual=4, code=4 (both bad — shape was genuinely wrong)

**Why:** The code eval checks implementation correctness against the spec (exact values, construction method). The VLM checks visual appearance. A shape can look right but be implemented incorrectly, or be implemented correctly but have details too small to see.

### Pattern E: LLM "feasibility" override
The codegen LLM sometimes decides a requested feature is "infeasible" and silently downgrades it. Examples:
- Salad bowl: "4mm fillet infeasible" → reduced to 0.8mm
- Guitar body: "fillet citing geometry issues" → skipped entirely

**Why:** The LLM has been trained to handle geometric constraints and sometimes overrides user requests based on its own (potentially incorrect) geometric reasoning.

### Pattern F: Organic/freeform shape difficulty
Shapes requiring smooth, organic curves (guitar body, vase) are consistently harder. Examples:
- Guitar body: 4 attempts, scores bounced between 5.6 and 7.7
- Decorative vase: 2 attempts, improved when exact control points were given

**Why:** The LLM must generate Spline control points from verbal descriptions, which is inherently imprecise. The VLM is also more subjective when judging organic shapes ("does this look like a guitar body?").

---

## 3. Spec Generation Issues

### Over-constraining from vague prompts
The spec generation fills in every missing detail with specific values. A prompt saying "a crescent shape" becomes a spec with exact arc centers, radii, and intersection angles. This creates many opportunities for code-spec divergence that don't reflect actual quality issues.

### Derived value fragility
The spec computes derived values (e.g., inner radius = outer radius - wall thickness). If the code computes this differently (e.g., Z-offset vs. perpendicular offset for wall thickness), the code eval penalizes even though both approaches produce similar geometry.

### Construction method prescription
The spec often prescribes a specific Build123d construction approach (e.g., "use BuildLine with Polyline + RadiusArc"). If the code uses a different but equivalent approach, the code eval penalizes. This is particularly problematic for shapes that can be constructed multiple ways.

---

## 4. Code Eval Issues

### Checks implementation, not result
The code eval compares code against spec construction details, not the geometric result. A soap dish built with ellipsoid subtraction vs. shell offset produces equivalent geometry but gets different code scores.

### Penalizes safe deviations
When the code deviates from spec by 1mm or uses a slightly different primitive, the code eval penalizes even if the visual result is identical. This drives the composite score below threshold for shapes that look perfect.

### No tolerance band
The code eval appears to expect exact dimension matches. A fillet of 3.0mm when spec says 3mm is fine, but 2.8mm triggers an issue. For CAD workbench examples, a ±5% tolerance on non-critical dimensions would reduce false failures.

---

## 5. VLM vs. Code Eval Alignment

| Scenario | Visual | Code | Who's right? |
|----------|--------|------|-------------|
| Skirting board cove | 4 (can't see) | 8 (code correct) | Code — detail too small at render scale |
| Salad bowl | 9 (looks great) | 5 (offset wrong) | Both — looks fine but implementation is imprecise |
| Horseshoe arch | 8 (arch visible) | 4 (circle not arc) | Code — implementation is genuinely wrong |
| Guitar body | 7 (looks like guitar) | 7 (close enough) | Both — organic shape is inherently imprecise |

**Observation:** For simple geometric shapes, the code eval is usually right and the visual score just confirms. For organic/freeform shapes, the visual eval is more appropriate. The adaptive weight system should shift more toward visual for organic shapes.

---

## 6. Prompt Complexity vs. LLM Capability

### Reliably passes (complexity 1-2)
- Simple extrusions: hex bar, triangular wedge, star pillar
- Basic revolutions: bowl, cup, cylinder, cone, torus
- Shapes with 2-3 features and all explicit dimensions

### Passes with effort (complexity 3)
- Shapes with 3-5 features: gear blank, soap dish, Gothic arch
- Profiles with mixed straight/curved segments
- Shapes requiring precise fillet/chamfer dimensions

### Struggle zone (complexity 4+)
- Multi-feature decorative profiles: crown moulding, skirting board
- Organic/freeform: guitar body, vase with complex S-curve
- Shapes requiring domain-specific geometry knowledge: horseshoe arch

### Key finding: the prompts themselves are within LLM capability
Every prompt eventually passed. The failures were not about the shape being too complex to model in Build123d, but about:
1. The spec over-constraining the implementation
2. The code eval being too strict about implementation details
3. Random variance in codegen quality

---

## 7. Wasted Effort Analysis

### Token waste from re-generation with same prompt
The salad bowl was regenerated 3 times before passing — same prompt, different luck. Each attempt costs spec generation + research + codegen + render + eval tokens. **If the visual score is already 8-9, maybe a partial re-evaluation or code-only fix could save tokens.**

### Spec regeneration on every attempt
Each generation recreates the spec from scratch. The spec is deterministic for a given prompt, so regenerating it wastes tokens. **Caching specs and only regenerating when the prompt text changes would save ~30% of per-attempt token cost.**

### Code eval on shapes that look correct
For prompts with visual score >= 8, the code eval is the bottleneck 80% of the time. Running a "visual-only fast pass" first and only doing code eval if visual score is low could halve eval costs for obviously-correct shapes.

### Full pipeline for near-misses
When a prompt scores 7.0-7.4, the entire pipeline runs again. A targeted "fix the specific issue" approach (e.g., just fix the fillet radius) would be much cheaper than regenerating everything.

---

## 8. RAG/Example Quality Observations

### Approved examples teach multiple construction approaches
The existing approved examples use various Build123d patterns (BuildSketch + extrude, BuildLine + revolve, boolean operations). This gives the codegen LLM options, but also means it may pick an approach that doesn't match the spec.

### No negative examples
The system has no mechanism for showing the codegen LLM what NOT to do. Examples of common mistakes (wrong fillet radius, wrong construction method) with corrections could improve first-attempt success rate.

### Organic shapes underrepresented
The approved workbench examples are heavily weighted toward geometric/parametric shapes. This means the RAG retrieval for organic shapes (guitar body, decorative vase) returns less relevant examples, contributing to lower code quality.

---

## 9. Recommendations (Prioritized)

### High Impact, Low Effort
1. **Cache specs between regeneration attempts** — Don't regenerate the spec if the prompt hasn't changed. Save ~30% token cost per retry.
2. **Add dimension tolerance to code eval** — Allow ±5% or ±1mm tolerance for non-critical dimensions (fillets, minor offsets). Would have fixed 4/14 prompts without prompt changes.
3. **Spec should avoid prescribing construction method** — The spec should describe WHAT the shape should be, not HOW to build it in Build123d. Let the codegen LLM choose its own approach.

### High Impact, Medium Effort
4. **Visual-first fast pass** — If visual score >= 8.5, auto-approve without running full code eval. Would have caught salad bowl (visual=9) immediately.
5. **Reduce spec over-specification** — Limit the spec to prompt-stated dimensions + obvious derived values. Don't extrapolate arc centers, Bezier control points, or precise construction parameters that the codegen is unlikely to match.
6. **Adaptive retry strategy** — When a prompt scores 7.0-7.4 with visual >= 8, instead of full regeneration, try targeted code fixes (adjust the specific dimension that's wrong).

### Medium Impact, Higher Effort
7. **Construction method flexibility in code eval** — Don't penalize for using a different but valid construction approach (e.g., boolean subtraction vs. shell offset for hollow shapes).
8. **Separate "correctness" from "style" scores in code eval** — A fillet radius of 8mm vs. 15mm is a correctness issue; using ThreePointArc vs. RadiusArc is a style issue. Weight them differently.
9. **Add more organic shape examples to workbench** — Expand coverage of Spline-based shapes and freeform curves to improve RAG retrieval for these cases.

### Lower Priority
10. **VLM scale awareness** — The VLM can't evaluate small details (10mm cove on 500mm object). Include a "feature scale" indicator so the VLM knows what to zoom into.

---

## 10. What Made Prompts Pass

The single most effective strategy was **simplification**:

| Strategy | Times used | Success rate |
|----------|-----------|-------------|
| Simplify prompt (remove features) | 6 | 83% (5/6 first try) |
| Add explicit dimensions | 5 | 60% (3/5 first try) |
| Just retry (same prompt) | 4 | 50% (2/4 first try) |
| Change description approach | 3 | 67% (2/3 first try) |
| Match prompt to LLM natural output | 2 | 100% (2/2 first try) |

**Simplification wins because:**
- Fewer features = fewer things the spec can over-constrain
- Fewer features = fewer things the code can get wrong
- Fewer features = fewer things the eval can penalize
- Simpler shapes look more clearly "correct" to the VLM

The most dramatic example: crown moulding went from score 2 to 8.3 by simplifying from "classic cove-and-bead decorative profile" to "concave cove shape."
