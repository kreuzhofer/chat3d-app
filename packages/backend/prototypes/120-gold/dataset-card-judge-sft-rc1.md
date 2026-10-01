---
pretty_name: Chat3D judge SFT — rc1
language:
  - en
task_categories:
  - image-text-to-text
tags:
  - cad
  - build123d
  - 3d
  - vision-language-model
  - llm-as-a-judge
  - visual-question-answering
size_categories:
  - n<1K
license: other
license_name: private-unreleased
viewer: false
---

# Chat3D judge SFT — rc1

A **private training set** for fine-tuning **rc1**, the second release candidate of Chat3D's local visual judge. The judge looks at eight rendered views of a Build123d CAD model and answers a checklist of yes/no requirement questions about it. Its answers decide whether a generated model is approved.

The set teaches judgement on hard cases: items where Chat3D's current judge (**rc0**) and a stronger reference judge disagreed, decided by a human, plus items both judges agreed on as a regulariser. It is **not** the public Chat3D dataset; that release, its licence and its card are a separate effort (chat3d-app #73 / #79).

| | |
|---|---|
| File | `judge-sft.tar.gz` (226 MB), one tarball |
| sha256 | `58fc9693f0980e65a839d59870d252e84e80560eebe81688d344f27c99c92403` |
| Samples | **879**, one per CAD example, each with **8 views** (7,032 PNGs) |
| Labelled checklist items | **1,113** |
| Judge instrument | `production@4892d8d1b160` (the production prompt and response schema, identified by hash) |
| Format | `judge-sft/openai-chat-v1` |
| Generated | 2026-10-01 |
| Source ticket | kreuzhofer/chat3d-app#120 (gold), #94 (exporter) |

## How to load

```bash
hf download danielkreuzhofer/chat3d-judge-sft-rc1 judge-sft.tar.gz --repo-type dataset --local-dir .
tar xzf judge-sft.tar.gz        # → samples.jsonl, manifest.json, images/
```

```python
import json
samples = [json.loads(l) for l in open("samples.jsonl")]
manifest = json.load(open("manifest.json"))
```

If `hf` hangs on the transfer (seen with `hf` 1.15's Xet path), set `HF_HUB_DISABLE_XET=1`.

## Structure

```
samples.jsonl    879 lines, one training sample each
manifest.json    provenance: rules, label source per item, held-out ids, judge pairs, counts
images/          <example_id>-<view>.png, 8 per example, ~30 KB each
```

### A sample (`samples.jsonl`)

OpenAI chat format, the same messages the judge sees in production:

- `id`: the CAD example's id (UUID). It joins to `manifest.json` → `samples[].id`.
- `images`: the eight image paths, relative to the tarball root.
- `messages`:
  - `system`: the judge's instrument prompt: the user's request, its category and complexity, the construction spec, and the checklist questions with the evidence rules.
  - `user`: "Please evaluate the following 3D model images:", then per view a label and an `image_url` part (`{"url": "images/<id>-front.png"}`), in the fixed order *Front, Back, Left, Right, Top, Bottom, 45° down, 45° up*.
  - `assistant`: the target, a JSON object:
    ```json
    {"score": 8, "issues": ["…"], "suggestions": ["…"],
     "checklist": [{"question": "…", "pass": true, "detail": "<view(s) checked>: <what was seen>"}]}
    ```

The `checklist` in the target lists **only the labelled items** of that example, in corpus order. Most samples carry one item (719 have 1, 109 have 2, 31 have 3, 17 have 4, 3 have 5). `score`, `issues` and `suggestions` are the reference judge's for the whole example. Each `detail` is the evidence from whichever side was right (see below), with the zoom follow-up's prefix stripped.

### The views

Eight orthographic and oblique renders of the model's STL from a fixed camera set: front, back, left, right, top, bottom, a 45° view from above and a 45° view from below. The renderer turns Build123d's Z-up model into its Y-up scene, so **the front view looks at the model's −Y face and the top view at +Z** (chat3d-app ADR 0007). That frame was not declared to the generator when these models were made; see *Known limitations*.

## Where the labels come from

Every labelled item is one checklist question on one example. `manifest.json` → `samples[].items[].source` says which kind it is:

| Source | Items | What it is |
|---|---|---|
| `adjudicated` | **160** (87 R, 73 C) | rc0 and the reference disagreed; **a human (the project owner) looked at the views and decided**. **R** = the reference was right, **C** = the candidate (rc0) was right. The target is the right side's answer and evidence. |
| `auto-C` | **61** | rc0 and the reference disagreed, and a third model (Kimi K3) **sided with rc0 at high confidence** (chat3d-app #108's one-sided rule). **Never seen by a human.** The target is rc0's answer. |
| `agreed` | **892** | rc0 and the reference gave the same answer. The target is that answer with the reference's evidence. Agreed **passes are capped at 3 per fail** across the set (242 fails kept, 726 of 9,882 available agreed passes sampled), so the agreed part is not dominated by easy passes. |

**What is excluded:**
- items decided **N** (neither judge right, or not answerable from the renders): 18 in the #120 sittings;
- items whose right answer was **uncertain**: nothing to learn;
- disagreements from sittings under an older instrument. The manifest lists them under `skippedSittings`.

Label totals: 871 pass / 242 fail.

**The judges involved:**
- **Candidate (rc0):** `chat3d-judge-rc0`, a LoRA fine-tune of Qwen3.8-27B, BF16, thinking off. It is the production judge.
- **Reference (second judge):** for the #120 sittings, DeepSeek V4.1 Flash (Nebius token factory, thinking off). Earlier sittings under the same instrument used other references; every sitting and its pair is listed in `manifest.json` → `judgePairs`, with per-sitting drop counts.
- **Triage:** Kimi K3 (Nebius), used only to pre-decide clear cases (`auto-C`). Never a judge.

**What the human decisions say about rc0:** across the #120 sittings, rc0's confirmed false passes (it passed a requirement the model does not meet) were **45**, against **13** for the reference. Its false fails were lower than the reference's: DeepSeek was markedly strict on simple parts. **Teaching rc1 not to pass what is not there is the main purpose of this set.**

## Where the examples come from

The examples are rows of the Chat3D workbench corpus: a natural-language request for a part ("A mushroom cap: wide flat dome profile revolved — 80mm diameter…"), Build123d code generated for it, and the code's renders. By category:

| Category | Samples |
|---|---|
| Missing Examples (simple parts collected from retrieval gaps) | 504 |
| Electronic Components | 51 |
| Arrays and Patterns | 43 |
| Generic Enclosures | 37 |
| Boolean Operations | 33 |
| Extrusions and Revolutions | 30 |
| bd_warehouse Examples / Surface Modifications | 28 each |
| Sketch Operations | 27 |
| Mechanical Components | 26 |
| Simple Everyday Objects | 25 |
| PCB Cases | 24 |
| Primitives | 16 |
| Gridfinity Storage | 5 |
| Hinges | 2 |

- **Codegen models:** the older corpus rows were generated mostly by Claude Sonnet 4.6. The rows added in September–October 2026 (the *Missing Examples* rows and the second generations of corpus prompts) were generated by Qwen3.8-27B (NVFP4) on the project's own cluster.
- **Checklist questions:** derived from the request as requirement atoms (chat3d-app ADR 0002), screened for wrong-question classes (#113). Questions about fine features or "…er than" comparatives are routed to a code reviewer and do not appear here.

## Held out: do not train on these

`manifest.json` → `heldOut` lists the **measurement set** (ADR 0004's fixed 125) and **every spot-check sample**, 2,023 example ids in total, with the experiment ids they come from. They are cut **by prompt**: other generations of a held-out prompt are excluded too. **None of them appear in `samples.jsonl`.** rc1's qualification measures on these ids. Training on them would make that measurement meaningless.

## Known limitations

- **Small and skewed.** 1,113 labelled items, most of them agreed passes. The human-decided core is 160 items. Over half the samples are simple *Missing Examples* parts, and the hard categories (Hinges, Gridfinity) are barely present.
- **61 `auto-C` labels are not human-verified.** They follow the one-sided triage rule chosen on #108's measurement (triage may only side with the candidate, and only at high confidence). A trainer may down-weight or drop them; they are marked per item.
- **`agreed` is two-model consensus, not truth.** Two judges can share a blind spot.
- **Orientation was undeclared.** Questions with direction words ("front face", "top edge", "lies flat") came from the request text. The generator had no declared frame, so a few labels rest on the adjudicator's reading of which side is "front". Several such items were dropped as N; some remain as R or C. ADR 0007 fixes this for future data, not for this set.
- **Renders only.** Interiors (hollow vs solid), hidden faces and exact dimensions cannot be judged from the eight views. Such questions are meant to be routed elsewhere, but a few may remain.
- **One adjudicator.** Every human decision is the project owner's.

## Intended use

Supervised fine-tuning of the Chat3D visual judge (rc1), starting from Qwen3.8-27B or rc0, then qualification under chat3d-app ADR 0004 on the held-out ids. Requests made for rc1 alongside this set:
- the MTP drafter **trained as its own step** against rc1's outputs (an aligned head), never adapted by accident through the judge LoRA's suffix-matched targets (`mtp.*` excluded from those);
- a parity check by tensor name against the base;
- an NVFP4 build beside BF16.

Not intended for public redistribution. Licensing and provenance of a public release are decided separately (chat3d-app #79).
