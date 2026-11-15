#!/bin/sh
# Keep apt output, arguments and exit status unchanged.
tool="${0##*/}"
case "$tool" in apt|apt-get) ;; *) exit 127 ;; esac
"/usr/bin/$tool" "$@"
result=$?
if [ "$result" -eq 0 ] && [ "$(id -u)" -eq 0 ]; then
  /usr/local/bin/wormstar-apt-track || true
  for arg in "$@"; do
    case "$arg" in
      upgrade|full-upgrade|dist-upgrade)
        root="${WORMSTAR_PERSIST_ROOT:-/persist}"
        if [ -f "$root/state/initialized" ]; then
          touch "$root/state/auto-upgrade-enabled"
        fi
        break
        ;;
    esac
  done
fi
exit "$result"
