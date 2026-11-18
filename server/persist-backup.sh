#!/usr/bin/env bash
# A small, private, portable *export* for owner-maintained projects and inventories.
# Deliberately does NOT archive ~/.ssh, API tokens, shell history or entire HOME.
# Keeping an archive on the SAME Railway volume is NOT an offsite backup.
set -Eeuo pipefail
umask 077
ROOT="${WORMSTAR_PERSIST_ROOT:-/persist}"
HOME_DIR="$ROOT/home/tuser"
DIR="$HOME_DIR/backups"
STATE="$ROOT/state"
MAX_INPUT_MIB=80

[[ "$(id -u)" -ne 0 ]] || { echo "Run persist backup as the non-root terminal user" >&2; exit 77; }
[[ -f "$STATE/initialized" && -d "$HOME_DIR" ]] || { echo "Persistent home is unavailable" >&2; exit 1; }
mkdir -p -m 700 "$DIR"
chmod 700 "$DIR"

usage(){
  echo "Usage: persist backup | persist backups | persist verify [snapshot-name.tgz] | persist unpack [snapshot-name.tgz]"
}
find_latest() {
  local latest
  latest="$(find "$DIR" -maxdepth 1 -type f -name 'star-home-*.tgz' -printf '%T@ %f\n' | sort -nr | head -n1 || true)"
  [[ -n "$latest" ]] || { echo "No backup snapshots yet" >&2; return 1; }
  printf '%s\n' "${latest#* }"
}
case "${1:-}" in
  backup)
    # Refuse to silently fill the small 500 MB Railway volume.
    count="$(find "$DIR" -maxdepth 1 -type f -name 'star-home-*.tgz' | wc -l)"
    if (( count >= 3 )); then
      echo "Maximum 3 snapshots on-volume. Export one offsite before deleting old copies." >&2
      exit 1
    fi
    sources=()
    for item in \
      home/tuser/projects \
      home/tuser/.bashrc \
      home/tuser/.profile \
      home/tuser/.config/wormstar/pip-packages.txt \
      home/tuser/.config/wormstar/npm-packages.json \
      home/tuser/.config/wormstar/training-progress.json \
      home/tuser/.config/wormstar/tools-activity.json \
      home/tuser/.config/wormstar/managed-tools.json \
      state/apt-manual.txt
    do
      [[ -e "$ROOT/$item" ]] && sources+=("$item")
    done
    (( ${#sources[@]} > 0 )) || { echo "No supported files for backup" >&2; exit 1; }
    bytes="$(du -sbc "${sources[@]/#/$ROOT/}" 2>/dev/null | awk 'END{print $1+0}')"
    # The above expansion works for paths without whitespace; all source names are fixed.
    if (( bytes > MAX_INPUT_MIB * 1024 * 1024 )); then
      echo "Selected files exceed ${MAX_INPUT_MIB} MiB. Store large repositories on GitHub first." >&2
      exit 1
    fi
    free_kib="$(df -Pk "$DIR" | awk 'END{print $4+0}')"
    if (( free_kib < (bytes + 1023) / 1024 + 16 * 1024 )); then
      echo "Insufficient Railway volume space for snapshot plus 16 MiB reserve." >&2
      exit 1
    fi
    name="star-home-$(date -u +%Y%m%dT%H%M%SZ)-$$.tgz"
    temp="$(mktemp "$DIR/.snapshot.XXXXXXXX")"
    trap 'rm -f "$temp"' EXIT
    tar -czf "$temp" \
      --exclude='*/.git' --exclude='*/node_modules' --exclude='*/.venv' \
      --exclude='*/.npm' --exclude='*/.cache' \
      --exclude='*/.env' --exclude='*/.env.*' --exclude='*/.npmrc' \
      --exclude='*/.ssh' --exclude='*/.aws' --exclude='*/.secrets' \
      --exclude='*credential*' --exclude='*password*' --exclude='*token*' \
      --exclude='*.pem' --exclude='*.key' --exclude='*.p12' --exclude='*.pfx' \
      --exclude='*.kdbx' --exclude='id_rsa*' --exclude='id_ed25519*' \
      -C "$ROOT" "${sources[@]}"
    tar -tzf "$temp" >/dev/null
    mv -n "$temp" "$DIR/$name"
    sha256sum "$DIR/$name" > "$DIR/$name.sha256"
    chmod 600 "$DIR/$name" "$DIR/$name.sha256"
    echo "Created private portable snapshot: $DIR/$name"
    echo "This is on the SAME Railway volume. Copy offsite for disaster recovery."
    ;;
  backups)
    find "$DIR" -maxdepth 1 -type f -name 'star-home-*.tgz' \
      -printf '%f  (%s bytes)\n' | sort
    ;;
  unpack)
    # Unpack to a new REVIEW directory only. Never overwrite live projects.
    name="${2:-latest}"
    [[ "$name" != latest ]] || name="$(find_latest)"
    [[ "$name" =~ ^star-home-[0-9]{8}T[0-9]{6}Z-[0-9]+\.tgz$ ]] || {
      echo "Invalid snapshot name" >&2; exit 2;
    }
    file="$DIR/$name"
    [[ -f "$file" && -f "$file.sha256" ]] || { echo "Snapshot or checksum missing" >&2; exit 1; }
    sha256sum -c --status "$file.sha256"
    tar -tzf "$file" >/dev/null
    # Reject unexpected paths in the archive even after checking its checksum.
    while IFS= read -r member; do
      [[ "$member" != /* && "$member" != *".."* ]] || {
        echo "Unsafe archive member" >&2; exit 1;
      }
      case "$member" in
        home/tuser/projects|home/tuser/projects/*|home/tuser/.profile|home/tuser/.bashrc|home/tuser/.config/wormstar/pip-packages.txt|home/tuser/.config/wormstar/npm-packages.json|home/tuser/.config/wormstar/training-progress.json|home/tuser/.config/wormstar/tools-activity.json|home/tuser/.config/wormstar/managed-tools.json|state/apt-manual.txt) ;;
        *) echo "Unexpected archive path; refusing extraction" >&2; exit 1 ;;
      esac
    done < <(tar -tzf "$file")
    mkdir -p -m 700 "$HOME_DIR/restored"
    target="$HOME_DIR/restored/${name%.tgz}"
    [[ ! -e "$target" ]] || { echo "Restore review folder already exists: $target" >&2; exit 1; }
    mkdir -m 700 "$target"
    tar -xzf "$file" -C "$target" --no-same-owner --no-same-permissions
    echo "Snapshot unpacked for REVIEW into: $target"
    echo "No existing project files or APT state were overwritten."
    ;;
  verify)
    name="${2:-latest}"
    [[ "$name" != latest ]] || name="$(find_latest)"
    [[ "$name" =~ ^star-home-[0-9]{8}T[0-9]{6}Z-[0-9]+\.tgz$ ]] || {
      echo "Invalid snapshot name" >&2; exit 2;
    }
    file="$DIR/$name"
    [[ -f "$file" && -f "$file.sha256" ]] || { echo "Snapshot or checksum missing" >&2; exit 1; }
    sha256sum -c --status "$file.sha256"
    tar -tzf "$file" >/dev/null
    echo "Verified SHA-256 and archive integrity: $name"
    ;;
  *) usage; exit 2 ;;
esac
