#!/usr/bin/env bash
# Fixed, owner-approved APT installation of AFL++ from the signed Debian mirror.
# Never accepts a package name, flags or command supplied by a browser.
set -Eeuo pipefail
umask 077
[[ $# -eq 0 && "$(id -u)" == 0 ]] || exit 77
[[ -f /persist/state/initialized ]] || { echo "Persistent tracking unavailable" >&2; exit 78; }
[[ -x /usr/local/bin/wormstar-apt-track ]] || exit 78
[[ -x /usr/bin/apt-get ]] || exit 78
export DEBIAN_FRONTEND=noninteractive
exec 9>/persist/state/afl-install.lock
flock -w 20 9 || { echo "Package manager is busy" >&2; exit 75; }
timeout -k 10s 180s /usr/bin/apt-get update -qq
timeout -k 10s 480s /usr/bin/apt-get install -y --no-install-recommends afl++
/usr/local/bin/wormstar-apt-track
/usr/bin/dpkg-query -W -f='\x24{Status}' 'afl++' | grep -qx 'install ok installed'
echo "AFL++ package installed and inventory saved"
