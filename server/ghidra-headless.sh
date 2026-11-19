#!/usr/bin/env bash
# STAR owner-only Ghidra Headless; no GUI, network server or analysis job
# starts unless the authenticated terminal explicitly invokes this binary.
set -Eeuo pipefail
export JAVA_HOME=/opt/java/openjdk
export PATH="$JAVA_HOME/bin:$PATH"
exec /opt/ghidra_12.0.4_PUBLIC/support/analyzeHeadless "$@"
