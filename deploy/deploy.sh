#!/bin/sh
# Ship Noggin to Jinx. The box keeps its own checkout at ~/apps/Noggin, so the unit
# of deployment is a fast-forward of that checkout plus a rebuild. Nothing is
# copied from here, which is what makes a deploy from CI and a deploy from a
# laptop the same operation.
#
# --ff-only rather than a plain pull: if the checkout on the box has drifted,
# stop and say so rather than quietly merging something nobody wrote.
#
# Rooms and accounts live in the container's volumes, untouched by a rebuild.
# The image build runs well past ten minutes from cold, hence the generous
# job timeout on the CI side.
set -eu
ssh ssh.futile.studio '
  set -eu
  cd ~/apps/Noggin
  git pull --ff-only
  docker compose up -d --build

  # Come back and check, rather than trusting that compose meant "serving".
  sleep 5
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4332/ || true)
  case "$code" in
    2*|3*) echo "noggin: serving on 127.0.0.1:4332 (HTTP $code)" ;;
    *) echo "noggin: not serving (HTTP $code)"; docker compose logs --tail 30; exit 1 ;;
  esac
'
echo "noggin: deployed to https://noggin.futile.studio"
