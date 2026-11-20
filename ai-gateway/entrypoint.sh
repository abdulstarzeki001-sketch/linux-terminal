#!/bin/sh
set -eu
# Railway volumes are commonly root-owned at mount time.
# Set ownership for the dedicated state directory, then drop privileges.
mkdir -p /data
chown node:node /data
chmod 0700 /data
if [ -f /data/star-agent-mcp.json ]; then
  chown node:node /data/star-agent-mcp.json
  chmod 0600 /data/star-agent-mcp.json
fi
exec gosu node "$@"
