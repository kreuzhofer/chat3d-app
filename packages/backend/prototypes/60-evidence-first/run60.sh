#!/bin/zsh
# PROTOTYPE (wayfinder #60) — the evidence-first experiment, one subcommand per step; records land next to this file.
#
#   run60.sh start <A|B>     create and start one arm on the 125 (variant60.ts builds the body) → exp60-<arm>.txt, start60-<arm>.txt
#   run60.sh status <A|B>    the arm's run status
#   run60.sh screen <A|B>    the qualification screen: the arm against the reference bc4354d4 (Sonnet 4.6 under
#                            production@4892d8d1b160) and, with B, arm B beside A → screen60-<arm>.txt, dump60-<arm>.md
#   run60.sh grade <A|B>     grade60.ts: the arm against the adjudicated truth on the 125 and its direction against the
#                            control 05c9a31e → grade60-<arm>.txt
#
# Sole tenancy (map #45, #65): nothing in chat while an arm runs; check afterwards with
#   prototypes/61-qualification/tenancy61.sh (must be 0 other tenants in the window).
setopt null_glob
S=$(cd "$(dirname "$0")" && pwd); cd "$S/../../../.."
TOKEN=$(cat /tmp/chat3d-token.txt); H="Authorization: Bearer $TOKEN"
# prototypes/ is not in the backend image: variant60.ts and grade60.ts run on the host against the dev database.
set -a; . ./.env 2>/dev/null; set +a; export DB_HOST=localhost
host_tsx() { (cd packages/backend && npx tsx "$@" 2>&1 | grep -v '^◇' | grep -v '^{"level"'); }
REF=bc4354d4-f946-4775-bf08-5e64f726c3a1      # Sonnet 4.6 (thinking off) on the 125 under production@4892d8d1b160 (#83)
CONTROL=05c9a31e-3825-4d71-8d42-89318e76a8b2  # qwen3.8-27b-nvfp4 (thinking off) arm A of #83, production shape
ARM=$2; [ -z "$ARM" ] && { echo "arm required (A or B)"; exit 1; }

case "$1" in
start)
  BODY=$(host_tsx prototypes/60-evidence-first/variant60.ts "$ARM" | tail -1)
  printf '%s' "$BODY" | python3 -c "import sys,json; b=json.load(sys.stdin); print('examples', len(b['exampleIds']), '| variant', b['judgePromptVariants'][0]['id'], b['judgePromptVariants'][0]['responseShape'], '| template chars', len(b['judgePromptVariants'][0]['template']))"
  printf '%s' "$BODY" | curl -s http://localhost/api/admin/vlm-experiments -H "$H" -H "Content-Type: application/json" -d @- > "$S/exp60-$ARM.json"
  EXP=$(python3 -c "import json; d=json.load(open('$S/exp60-$ARM.json')); print(d.get('id') or d)"); echo "$EXP" | tee "$S/exp60-$ARM.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ | tee "$S/start60-$ARM.txt"
  curl -s -X POST "http://localhost/api/admin/vlm-experiments/$EXP/start" -H "$H"; echo
  ;;
status)
  curl -s "http://localhost/api/admin/vlm-experiments/$(cat "$S/exp60-$ARM.txt")/status" -H "$H"; echo ;;
screen)
  RUN=$(curl -s "http://localhost/api/admin/vlm-experiments/$(cat "$S/exp60-$ARM.txt")/status" -H "$H" | python3 -c "import sys,json; print(json.load(sys.stdin)['runs'][0]['runId'])")
  echo "$RUN" > "$S/run60-$ARM.txt"
  ARMS=(--candidate "$RUN"); [ "$ARM" = "B" ] && [ -f "$S/run60-A.txt" ] && ARMS=(--candidate "$(cat "$S/run60-A.txt")" --candidate "$RUN")
  docker compose exec -T backend npx tsx scripts/qualification-screen.ts "${ARMS[@]}" --reference "$REF" --dump "/tmp/dump60-$ARM.md" 2>&1 \
    | grep -v '^{"level"' | grep -v '^◇' | tee "$S/screen60-$ARM.txt"
  docker cp "chat3d-backend:/tmp/dump60-$ARM.md" "$S/dump60-$ARM.md" && echo "dump → $S/dump60-$ARM.md"
  ;;
grade)
  host_tsx prototypes/60-evidence-first/grade60.ts "$(cat "$S/exp60-$ARM.txt")" "$CONTROL" | tee "$S/grade60-$ARM.txt"
  ;;
*) echo "usage: run60.sh start|status|screen|grade <A|B>"; exit 1 ;;
esac
