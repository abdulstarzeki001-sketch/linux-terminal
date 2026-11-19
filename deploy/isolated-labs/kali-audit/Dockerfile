# Official Kali Linux image. Rolling package versions are recorded by apt
# in CI; rebuild images for updates rather than installing at every startup.
FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      netexec ligolo-ng ca-certificates \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/* \
 && command -v nxc \
 && command -v ligolo-proxy \
 && test -x "$(command -v nxc)" \
 && test -x "$(command -v ligolo-proxy)"

RUN useradd --uid 10001 --create-home --shell /bin/bash lab \
 && install -d -o lab -g lab -m 0700 /workspace

USER 10001:10001
ENV HOME=/workspace
WORKDIR /workspace
CMD ["/bin/bash", "-lc", "command -v nxc && command -v ligolo-proxy"]
