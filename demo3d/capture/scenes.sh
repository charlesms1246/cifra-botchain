#!/usr/bin/env bash
# Render every deck scene to its own file — PLAN.md §11.
#
#   capture/scenes.sh [WIDTH] [HEIGHT] [FPS] [CRF] [OUTDIR]
#
# Defaults to 2560x1440 (QHD) at 60fps, CRF 14. The deck is composed for 16:9
# — the caption block, the lower-sixth clearance and the title block all sit
# on that aspect — so any override should keep it. DCI 2K (2048x1080) is 1.9:1
# and would restage every frame.
#
# Each file is exactly one loop of its scene, so each one is itself seamless.
# Do NOT edit src/ while this runs: Vite hot-reloads the page and the capture
# loses window.__seek mid-scene.
set -euo pipefail

W=${1:-2560}
H=${2:-1440}
FPS=${3:-60}
CRF=${4:-14}
OUT=${5:-out/2k}

cd "$(dirname "$0")/.."
mkdir -p "$OUT"

# id:label — the label is only for the filename, so a reviewer can tell the
# eight files apart in a folder without opening them.
SCENES=(
  "s0:trade" "s1:commitment" "s2:grade" "s3:attest"
  "s4:vault" "s5:waterfall" "s6:governance" "s7:deployed"
)

echo "== ${#SCENES[@]} scenes -> ${W}x${H} @ ${FPS}fps, crf ${CRF}, into ${OUT}/"
for entry in "${SCENES[@]}"; do
  id=${entry%%:*}
  label=${entry##*:}
  echo "-- ${id} (${label})"
  node capture/frames.mjs "$id" \
    --w "$W" --h "$H" --fps "$FPS" --crf "$CRF" \
    --out "${OUT}/${id}-${label}.mp4"
done

echo
echo "== done"
ls -la "$OUT"
