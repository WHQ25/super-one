# Local-only remote Linux node: OpenSSH + Bun (install) + Node (runtime).
# better-sqlite3 NAPI crashes under Bun — CLI runs on Node via tsx.
# superone binds 127.0.0.1 inside the container; host reaches it via SSH -L.
FROM oven/bun:1.3-debian

USER root

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server \
    curl \
    ca-certificates \
    python3 \
    make \
    g++ \
    tini \
    gnupg \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/run/sshd \
  && (id superone >/dev/null 2>&1 || useradd -m -s /bin/bash superone) \
  && echo 'superone:superone' | chpasswd \
  && mkdir -p /home/superone/.ssh /home/superone/.superone/node /work \
  && chown -R superone:superone /home/superone /work \
  && chmod 700 /home/superone/.ssh \
  && node --version && npm --version

# Local-dev only: password auth + key auth. Prefer lab-keys authorized_keys.
COPY sshd_config /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && ssh-keygen -A

ENV SUPERONE_NODE_HOME=/home/superone/.superone/node \
    SUPERONE_NODE_HOST=127.0.0.1 \
    SUPERONE_NODE_PORT=7788 \
    SUPERONE_SSH_USER=superone \
    WORK_DIR=/work \
    npm_config_update_notifier=false

EXPOSE 22

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
