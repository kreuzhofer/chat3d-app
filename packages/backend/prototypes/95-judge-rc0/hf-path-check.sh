#!/usr/bin/env bash
# chat3d #95 — verify the Hugging Face publishing path before a Nebius run.
#
# Proves, from this machine: a write token is present; a private dataset repo
# and a private model repo can be created under the chosen namespace; the judge
# SFT export round-trips (upload, download with the same token, sha256 match).
# The cross-machine legs (Nebius pulls the dataset with a READ token; Nebius
# pushes weights; the Spark cluster pulls them) are printed as a checklist at
# the end — they run where those machines are.
#
# Usage: hf-path-check.sh <namespace> <path/to/judge-sft.tar.gz> [suffix]
#   namespace: HF user or org, e.g. kreuzhofer
#   suffix:    repo-name suffix, default rc0
set -euo pipefail
NS=${1:?namespace}; TAR=${2:?judge-sft.tar.gz}; SUF=${3:-rc0}
DS="$NS/chat3d-judge-sft-$SUF"; MD="$NS/chat3d-judge-$SUF"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

echo "== 1. token"; hf auth whoami
echo "== 2. repos (private)"
hf repo create "$DS" --repo-type dataset --private --exist-ok
hf repo create "$MD" --repo-type model   --private --exist-ok
echo "== 3. upload the export"
mkdir -p "$WORK/up"; tar xzf "$TAR" -C "$WORK/up"
( cd "$WORK/up" && find . -type f | sort | xargs shasum -a 256 > "$WORK/up.sha" )
hf upload "$DS" "$WORK/up" . --repo-type dataset --commit-message "judge-sft export $(date -u +%FT%TZ)"
echo "== 4. download it back with the same token"
hf download "$DS" --repo-type dataset --local-dir "$WORK/down" >/dev/null
( cd "$WORK/down" && find . -type f ! -path './.cache/*' ! -name '.gitattributes' | sort | xargs shasum -a 256 > "$WORK/down.sha" )
if diff -q "$WORK/up.sha" "$WORK/down.sha" >/dev/null; then echo "round trip OK: $(wc -l < "$WORK/up.sha") files identical"; else echo "ROUND TRIP MISMATCH"; diff "$WORK/up.sha" "$WORK/down.sha" | head; exit 1; fi
cat <<CHK

== remaining legs (run where each machine is) ==
[ ] Nebius node:  HF_TOKEN=<read token>  hf download $DS --repo-type dataset --local-dir ./judge-sft   (39.5 MB, 1,216 PNGs)
[ ] Nebius node:  HF_TOKEN=<write token> hf upload $MD ./merged .   (or the adapter) — private model repo
[ ] Spark cluster: HF_TOKEN=<read token>  hf download $MD --local-dir ./judge-$SUF   — then NVFP4 + serve
CHK
