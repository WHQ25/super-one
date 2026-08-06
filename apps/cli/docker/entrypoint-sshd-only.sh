#!/usr/bin/env bash
# Clean-host lab: only OpenSSH. No monorepo mount, no pre-started superone.
# Used to exercise desktop registry install + SSH bootstrap against a blank Linux box.
set -euo pipefail

if [[ -f /authorized_keys ]]; then
  install -o superone -g superone -m 600 /authorized_keys /home/superone/.ssh/authorized_keys
fi

mkdir -p /home/superone/.ssh /home/superone/.local/bin /home/superone/.npm
chown -R superone:superone /home/superone
chmod 700 /home/superone/.ssh

echo "[clean-host] sshd only (no superone preinstall). Node $(node -v) npm $(npm -v)"
exec /usr/sbin/sshd -D -e
