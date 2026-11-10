#!/usr/bin/env bash
# Re-capture the render-core reference shots into shots/render/ (software WebGL: a few minutes in total).
#   sandbox/render/capture.sh [group…]     groups: hero tonemap looks refl quality feedback dof integration sheets
# `sheets` (needs ImageMagick `montage`) rebuilds the contact sheets sheet-*.png / tonemap-grid.png from the shots.
cd "$(dirname "$0")/../.."
OUT=shots/render
URL="/sandbox/render/?manual=1&q=high"
CAM="__h.setCam([-1.2,1.75,9.5],[0.5,2.4,-22])"
shot() { node tools/shot.cjs "$@" --timeout 170000 2>&1 | grep -E "eval error|page errors: [1-9]|never became ready|^  !" ; }
want() { [ $# -eq 0 ] && return 0; for g in "${GROUPS_[@]}"; do [ "$g" = "$1" ] && return 0; done; return 1; }
GROUPS_=("$@"); [ ${#GROUPS_[@]} -eq 0 ] && GROUPS_=(hero tonemap looks refl quality feedback dof integration sheets)

if want hero; then
  shot "$URL" --eval "($CAM, __step(0.1))" --shot $OUT/hero-core.png \
    --eval "(__h.setCam([-5.5,1.75,-9],[2,2.6,-30],50), __step(0.1))" --shot $OUT/hero-core-figure.png \
    --eval "(__h.setCam([-3,1.7,-2],[6.6,0.6,-9]), __step(0.1))" --shot $OUT/hero-core-violet.png
  shot "$URL&nopost=1" --eval "($CAM, __step(0.1))" --shot $OUT/chain-nopost.png
fi

if want tonemap; then
  shot "$URL" --eval "($CAM, __step(0.1))" --shot $OUT/tonemap-aces.png \
    --eval "(__tm('agx'), __step(0.05))" --shot $OUT/tonemap-agx.png \
    --eval "(__tm('agxPunchy'), __step(0.05))" --shot $OUT/tonemap-agxPunchy.png \
    --eval "(__tm('neutral'), __step(0.05))" --shot $OUT/tonemap-neutral.png
fi

if want looks; then
  ARGS=()
  for n in neutral crash pressureHall survivorBend frozen relay atrium breach gallery crucible woundGallery core observation hangar witness; do
    ARGS+=(--eval "(__look('$n'), __env(true), __step(0.1))" --shot "$OUT/look-$n.png")
  done
  shot "$URL" --eval "$CAM" "${ARGS[@]}"
fi

if want refl; then
  shot "$URL" --eval "($CAM, __step(0.1))" --shot $OUT/refl-on.png \
    --eval "(__refl(false), __step(0.1))" --shot $OUT/refl-off.png \
    --eval "(__refl(true), __r.registerReflectiveFloor(__r.scene.getObjectByName('floor'), { roughness: 0.15 }), __step(0.1))" --shot $OUT/refl-roughness-015.png \
    --eval "(__r.registerReflectiveFloor(__r.scene.getObjectByName('floor'), { strength: 2.5 }), __step(0.1))" --shot $OUT/refl-strength-25.png \
    --eval "(__r.registerReflectiveFloor(__r.scene.getObjectByName('floor')), __h.setCam([0.3,1.2,2.5],[0.3,0.5,-3]), __step(0.1))" --shot $OUT/refl-close.png \
    --eval "(__h.setCam([-17.5,4.7,6],[-16,3.2,-20]), __step(0.5), __step(0.5))" --shot $OUT/refl-upper-plane.png
fi

if want quality; then
  for q in low medium high ultra; do
    shot "/sandbox/render/?manual=1&q=$q" --eval "($CAM, __step(0.1))" --shot $OUT/quality-$q.png
  done
fi

if want feedback; then
  ARGS=()
  for k in hit heal corruption frost cinder flash gold; do
    ARGS+=(--eval "(__step(6), __pulse('$k', 1), __step(0.12))" --shot "$OUT/pulse-$k.png")
  done
  shot "$URL" --eval "($CAM, __step(0.1))" "${ARGS[@]}" \
    --eval "(__step(6), __corrupt(0.5), __step(2), __step(0.1))" --shot $OUT/corruption-050.png \
    --eval "(__corrupt(1), __step(2), __step(0.1))" --shot $OUT/corruption-100.png
fi

if want dof; then
  shot "$URL" --eval "(__h.setCam([0.2,1.3,3.2],[0.3,0.7,-3],40), __step(0.1))" --shot $OUT/dof-off.png \
    --eval "(__dof(5.2, 0.9), __step(1.5), __step(0.1))" --shot $OUT/dof-near.png \
    --eval "(__dof(40, 0.9), __step(1.5), __step(0.1))" --shot $OUT/dof-far.png
fi

if want integration; then
  shot "$URL&sky=woundVista&open=1&look=woundGallery&mats=1" --eval "(__h.setCam([-1.2,1.75,9.5],[0.5,3.4,-22]), __step(0.2), __step(0.2))" --shot $OUT/integration-sky-mats.png \
    --eval "(__h.setCam([0.3,1.2,2.5],[0.3,0.5,-3]), __step(0.1))" --shot $OUT/integration-sky-mats-close.png
  shot "$URL&mats=1&look=relay" --eval "(__h.setCam([4.2,1.3,-5.5],[7.2,0.5,-9.6],45), __step(0.1))" --shot $OUT/integration-relay-ao.png
fi
if want sheets && command -v montage >/dev/null; then
  sheet() { # sheet <out> <columns> <shot name…>
    local out=$1 cols=$2 args=(); shift 2
    for n in "$@"; do [ -f "$OUT/$n.png" ] && args+=(-label "$n" "$OUT/$n.png"); done
    [ ${#args[@]} -gt 0 ] && montage "${args[@]}" -tile "${cols}x" -geometry 640x360+2+2 -background '#0b0b0c' -fill '#d8d8d8' -pointsize 14 -depth 8 "$OUT/$out.png"
  }
  sheet sheet-chain 3 hero-core chain-nopost hero-core-figure refl-on refl-off refl-close refl-roughness-015 refl-strength-25 refl-upper-plane
  sheet tonemap-grid 2 tonemap-aces tonemap-agx tonemap-agxPunchy tonemap-neutral
  sheet sheet-looks 5 look-neutral look-crash look-pressureHall look-survivorBend look-frozen look-relay look-atrium look-breach \
    look-gallery look-crucible look-woundGallery look-core look-observation look-hangar look-witness
  sheet sheet-quality 2 quality-low quality-medium quality-high quality-ultra
  sheet sheet-feedback 3 pulse-hit pulse-heal pulse-corruption pulse-frost pulse-cinder pulse-flash pulse-gold corruption-050 corruption-100 \
    dof-off dof-near dof-far
fi
echo "captured: ${GROUPS_[*]}"
