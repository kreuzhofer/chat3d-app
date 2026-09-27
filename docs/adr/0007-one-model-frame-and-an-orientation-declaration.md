---
status: accepted
date: 2026-09-27
---

# Every model is built in one Model frame, and every prompt declares its orientation

"Front" existed in three places that never agreed explicitly: the prompt (which usually does not say), the generated code (which picked a face and never recorded which), and the renders (where "front" is wherever the fixed camera looks from). A question such as "the USB-C opening is on the front face" was right only if all three happened to line up. #113 measured the cost — orientation-worded questions were a leading class of N adjudications — and screened direction words out of the questions. That treats the symptom. We decided instead that orientation is a contract (#125): one **Model frame** for code, renders and questions, and an **Orientation declaration** per prompt.

## The frame

**Z up as the object is used, front facing −Y, right facing +X** (left and right as seen facing the front). This is not a new convention but a written-down old one: the screenshot renderer already turns Build123d's Z-up model into its Y-up scene by −90° around X (`services/screenshot-service/app/screenshot_renderer.py`), so its front camera has always looked at the −Y face and its top camera at +Z. Neither the spec prompt nor the codegen prompt said so anywhere.

**The code builds in the frame; renders are never turned to fit a model.** The alternative — let codegen build in any orientation and have the renderer rotate each model so its declared front meets the front camera — gives codegen freedom, but "front" then means nothing in the code, the code reviewer cannot check a direction from coordinates, and the corpus stops being comparable across rows. One frame lets the reviewer read "the USB cut lies at y < 0" straight off the code, and later lets a geometry check measure it from the model file.

**Up means in use**, as prompts describe objects ("the lid sits on top"), unless a prompt explicitly asks for print orientation. Print orientation is the slicer's concern.

## The declaration

A **structured field on the prompt's spec**, not a prose line — codegen, the code reviewer and the judge all read it, and a check has to parse it: what is up, and which feature faces front, or **"no front"** for objects without one (a sphere, a washer, a plain plate). With "no front", no question may use front/back/left/right. A prompt's own direction words **map onto the frame** (its "front" is −Y) rather than being rewritten away: they are the user's intent, and with a declared frame they are checkable.

When the prompt is silent, the spec picks the front **by rule**: the face with the features the user interacts with (ports, buttons, display, an opening, a label); otherwise the face a feature points out of (a spout, a hook's opening); otherwise "no front" — never an invented front.

## What is gated

**A front the spec chose is a construction decision, not a requirement, and is never gated.** Gating a fact the user did not ask for is the error #113 removed. Whether the code followed its own declaration is a **consistency check** — visible, not counted by the Gate. Questions stay feature-based ("the ports are all on one short wall").

**Direction questions the prompt itself states** are requirements and are gated: they route to the **code reviewer**, which checks the feature's position against the frame, and additionally to the **visual judge** once the instrument shows it the declaration (the next instrument revision). Until then the judge is not asked them.

## Consequences

- The existing corpus was generated with no frame. Going forward only, except the prompts whose text uses front/back/rear (236 on 2026-09-27): at the next criteria regeneration they get a declaration, and stored rows whose code put the feature elsewhere fail those items — legitimately, since the user asked for "front". Whether to regenerate their code is decided once that regeneration shows how many fail.
- Showing the judge the declaration changes the instrument, so it lands with an instrument revision (bundled with *Structural items gate first*, #114), never on its own.
- The renderer's rotation is now load-bearing: changing the camera set or the Z-up→Y-up transform changes what "front" means for every row, and needs this ADR revised.
- Glossary: *Model frame*, *Orientation declaration* (CONTEXT.md).
