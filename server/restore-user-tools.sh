#!/usr/bin/env bash
# Explicit, user-requested recovery from package name/version manifests.
# Never run automatically at boot: package registry downloads are not trusted input.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" -ne 0 ]] || { echo "Run as tuser, not root" >&2; exit 77; }
ROOT="${WORMSTAR_PERSIST_ROOT:-/persist}"
HOME_DIR="$ROOT/home/tuser"
META="$HOME_DIR/.config/wormstar"
[[ -f "$ROOT/state/initialized" ]] || { echo "Persistent volume unavailable" >&2; exit 1; }
[[ -d "$HOME_DIR" ]] || { echo "Persistent home unavailable" >&2; exit 1; }
errors=0

if [[ -s "$META/pip-packages.txt" ]]; then
  if [[ ! -x "$HOME_DIR/.venv/bin/python" ]]; then
    echo "Python environment is unavailable. Do not overwrite it: back up and migrate the venv." >&2
    errors=1
  else
    valid=1
    while IFS= read -r entry || [[ -n "$entry" ]]; do
      [[ -z "$entry" ]] && continue
      if ! [[ "$entry" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*==[0-9][a-zA-Z0-9_.!+~-]*$ ]]; then
        valid=0
      fi
    done < "$META/pip-packages.txt"
    if (( valid == 0 )); then
      echo "Invalid Python package snapshot; refusing to interpret pip flags or URLs." >&2
      errors=1
    else
      echo "[PERSIST] Restoring pinned user Python packages..."
      timeout -k 10s 480s "$HOME_DIR/.venv/bin/python" -m pip install \
        --no-input --disable-pip-version-check --requirement "$META/pip-packages.txt" || errors=1
    fi
  fi
else
  echo "[PERSIST] No saved Python package inventory. Run persist save first."
fi

if [[ -s "$META/npm-packages.json" ]]; then
  echo "[PERSIST] Checking pinned global npm packages..."
  mapfile -t modules < <(node - "$META/npm-packages.json" <<'NODE'
const fs=require('node:fs');
const file=process.argv[2];
let data;
try { data=JSON.parse(fs.readFileSync(file,'utf8')); }
catch { process.exit(1); }
const entries=Object.entries(data.dependencies||{}).sort(([a],[b])=>a.localeCompare(b));
if(entries.length>40)process.exit(1);
for(const [name,val] of entries){
  if(!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name))process.exit(1);
  const ver=val?.version;
  if(typeof ver!=='string'||!/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(ver))continue;
  console.log(name+'@'+ver);
}
NODE
  )
  # Process substitutions suppress the child status; validate JSON separately.
  if ! node -e 'const x=require(process.argv[1]); const d=x.dependencies||{};if(Object.keys(d).length>40)process.exit(1);for(const n of Object.keys(d)){if(!/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(n))process.exit(1)}' "$META/npm-packages.json"; then
    echo "Invalid npm snapshot; refusing to install packages." >&2
    errors=1
  else
    for module in "${modules[@]}"; do
      [[ -n "$module" ]] || continue
      echo "[PERSIST] Restoring npm package ${module%%@*}..."
      if ! timeout -k 10s 180s npm install -g \
        --ignore-scripts --prefix "$HOME_DIR/.npm-global" -- "$module"; then
        errors=1
      fi
    done
  fi
else
  echo "[PERSIST] No saved npm global package inventory. Run persist save first."
fi

(( errors == 0 )) || { echo "Some user packages could not be repaired; data remain unchanged." >&2; exit 1; }
echo "[PERSIST] User package restoration completed."
