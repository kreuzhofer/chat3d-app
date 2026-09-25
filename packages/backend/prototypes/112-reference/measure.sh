#!/usr/bin/env bash
# #112: floors, cross-agreement and the two Kimi-vs-GLM sittings, once the runs exist.
# Run ids (2026-09-25): GLM-125 A1/A2, Kimi-off-125 B1'/B2', GLM-250 C, Kimi-off-250 D'.
set -u
GLM_A1=2bb33644-6c47-45e0-a006-5bb6673ae1f7; GLM_A2=1a0ac250-b119-4f40-8436-e6b7b401cd27
KIMI_B1=cc5c1d9c-db0b-4064-b669-4e6a5d3c1202; KIMI_B2=1ed0befe-b8ac-49d5-b12a-bb2b08a36af8
GLM_C=f629a83e-463f-4571-8492-118fbbab072d; KIMI_D=475a7939-440b-4468-a853-534c2f7f269c
INCUMBENT=05c9a31e-3825-4d71-8d42-89318e76a8b2; RC0=2f629877-dab6-452b-a011-5dc5dab54c4a
screen() { docker compose exec -T backend npx tsx scripts/qualification-screen.ts "$@" 2>&1 | grep -v 'DEBUG\|overrideCount\|injected\|subscribed'; }
sec() { echo; echo "=================== $1"; }
sec "Kimi-off self-pair on the 125 (floor)";         screen --candidate $KIMI_B1 --candidate $KIMI_B2 --reference $INCUMBENT | sed -n '/COMPLETENESS/,/THROUGHPUT/p' | grep -E 'answered|FAIL|hard flips \(arm|identical items \(arm'
sec "GLM-off self-pair on the 125 (floor)";          screen --candidate $GLM_A1 --candidate $GLM_A2 --reference $INCUMBENT | sed -n '/STABILITY/,/THROUGHPUT/p' | grep -E 'hard flips \(arm|identical items \(arm'
sec "Kimi vs GLM on the 125 (disagreement set)";     screen --candidate $KIMI_B1 --reference $GLM_A1 | grep -A6 'RAW AGREEMENT' | grep -E 'items 511|raw false'
sec "Kimi vs GLM on the 250 (disagreement set)";     screen --candidate $KIMI_D --reference $GLM_C | grep -A6 'RAW AGREEMENT' | grep -E 'all items|raw false'
sec "each vs the incumbent on the 125 (lean)";       screen --candidate $KIMI_B1 --reference $INCUMBENT | grep -A6 'RAW AGREEMENT' | grep -E 'items 511|raw false'; screen --candidate $GLM_A1 --reference $INCUMBENT | grep -A6 'RAW AGREEMENT' | grep -E 'items 511|raw false'
sec "each vs rc0 on the 125";                        screen --candidate $KIMI_B1 --reference $RC0 | grep -A6 'RAW AGREEMENT' | grep -E 'items 511|raw false'; screen --candidate $GLM_A1 --reference $RC0 | grep -A6 'RAW AGREEMENT' | grep -E 'items 511|raw false'
