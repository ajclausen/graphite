#!/bin/sh
set -eu

DATA_PATH="${DATA_DIR:-/data}"
RUN_UID="${PUID:-$(id -u graphite)}"
RUN_GID="${PGID:-$(id -g graphite)}"

mkdir -p "$DATA_PATH"

if ! chown -R "$RUN_UID:$RUN_GID" "$DATA_PATH" 2>/dev/null; then
  echo "Warning: failed to chown $DATA_PATH to $RUN_UID:$RUN_GID" >&2
fi

if ! su-exec "$RUN_UID:$RUN_GID" sh -c "touch '$DATA_PATH/.graphite-write-test' && rm -f '$DATA_PATH/.graphite-write-test'"; then
  echo "Error: $DATA_PATH is not writable by uid:gid $RUN_UID:$RUN_GID" >&2
  echo "Set PUID/PGID to match your host appdata ownership or fix permissions on the mounted path." >&2
  exit 1
fi

exec su-exec "$RUN_UID:$RUN_GID" "$@"
