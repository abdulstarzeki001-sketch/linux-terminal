FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ghidra ca-certificates \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Find the upstream-installed headless analyzer. Do not start the GUI.
RUN set -eu; \
  found="$(find /usr/share /opt -type f -name analyzeHeadless -print -quit)"; \
  test -n "$found"; \
  chmod +x "$found"; \
  ln -s "$found" /usr/local/bin/star-ghidra-headless; \
  test -x /usr/local/bin/star-ghidra-headless

RUN useradd --uid 10001 --create-home --shell /bin/bash lab \
 && install -d -o lab -g lab -m 0700 /workspace
USER 10001:10001
ENV HOME=/workspace
WORKDIR /workspace
CMD ["/bin/bash", "-lc", "test -x /usr/local/bin/star-ghidra-headless && echo GHIDRA_HEADLESS_READY"]
