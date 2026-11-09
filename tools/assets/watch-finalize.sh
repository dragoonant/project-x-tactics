#!/bin/bash
# usage: watch-finalize.sh <hy log> slug...   waits for "<slug> done" in the log, then fetches and finalizes (CPU only)
log=$1; shift
for s in "$@"; do
  until grep -q "^$s done\|^$s failed\|^$s cancelled" "$log"; do sleep 5; done
  grep -q "^$s done" "$log" && node tools/assets/hyfetch.mjs $s && node tools/assets/finalize.mjs $s
done
