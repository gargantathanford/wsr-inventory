#!/bin/sh
set -e

# Named Docker volumes are created root-owned. On Linux hosts the container's
# non-root user usually inherits access fine; on Docker Desktop for Mac the VM's
# file-sharing layer does NOT, and a non-root UID gets a read-only view — which
# surfaces as SQLite "attempt to write a readonly database".
#
# Rather than maintain two different configs (hardened for Linux, root-for-Mac),
# this entrypoint starts as root, takes ownership of the data directories, then
# drops to the unprivileged user before exec'ing the real command. Same image,
# same compose file, correct behaviour on both.

TARGET_UID="${APP_UID:-1001}"
TARGET_GID="${APP_GID:-1001}"

for dir in /app/data /app/backups; do
  if [ -d "$dir" ]; then
    # Only chown when needed — on large upload dirs a blanket recursive chown
    # every boot is slow, so check the directory itself first.
    current="$(stat -c '%u' "$dir" 2>/dev/null || echo unknown)"
    if [ "$current" != "$TARGET_UID" ]; then
      echo "[entrypoint] fixing ownership of $dir -> ${TARGET_UID}:${TARGET_GID}"
      chown -R "${TARGET_UID}:${TARGET_GID}" "$dir" || \
        echo "[entrypoint] WARNING: could not chown $dir; continuing"
    fi
  fi
done

# If we're already non-root (some platforms force a UID), just run the command.
if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

exec gosu "${TARGET_UID}:${TARGET_GID}" "$@"
