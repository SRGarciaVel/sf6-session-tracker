#!/usr/bin/env bash
# Curated, compressed evidence from the full QA screenshots (run qa.mts first).
set -euo pipefail
cd "$(dirname "$0")/../screenshots"
mkdir -p evidence
conv() { ffmpeg -loglevel error -y -i "full/$1.png" -vf "scale='min(iw,1440)':-1" -q:v 4 "evidence/$1.jpg"; }
for n in es--desktop--prepare es--desktop--prepare-off es--desktop--live es--desktop--live-pending \
  es--desktop--live-empty es--desktop--recap es--desktop--recap-norating es--desktop--recap-empty \
  es--desktop--controls es--desktop--overlays es--desktop--lp es--laptop--live es--laptop--recap \
  es--mobile--live es--mobile--recap es--mobile--prepare-off es--mobile--overlays \
  en--desktop--live en--mobile--live en--mobile--recap focus-cta--desktop flow-recap--desktop; do
  conv "$n"
done
for v in desktop mobile; do
  ffmpeg -loglevel error -y -i "full/es--$v--page.png" \
    -vf "crop=iw:min(ih\,4200):0:0,scale='min(iw,1000)':-1" -q:v 5 "evidence/es--$v--page-top.jpg"
done
E=../../phase-5-6a/screenshots/evidence
ffmpeg -loglevel error -y -i "$E/fight-session--live--desktop.jpg" -i full/es--desktop--live.png \
  -filter_complex "[0]crop=1310:560:65:80,scale=1000:-1[a];[1]scale=1000:-1[b];[a][b]vstack" \
  -q:v 4 evidence/compare--live--prototype-vs-component.jpg
ffmpeg -loglevel error -y -i "$E/fight-session--recap--desktop.jpg" -i full/es--desktop--recap.png \
  -filter_complex "[0]crop=1310:700:65:80,scale=1000:-1[a];[1]crop=1304:420:0:0,scale=1000:-1[b];[a][b]vstack" \
  -q:v 4 evidence/compare--recap--prototype-vs-component.jpg
cp qa-report.json evidence/showcase-qa-report.json
