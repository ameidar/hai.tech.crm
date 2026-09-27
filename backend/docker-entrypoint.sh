#!/bin/sh
set -e

APP_USER="${APP_USER:-nodejs}"
APP_UID="${APP_UID:-1001}"
APP_GID="${APP_GID:-65533}"
UPLOADS_DIR="${UPLOADS_DIR:-/app/uploads}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOADS_DIR/instructor" "$UPLOADS_DIR/videos"

  # Release swaps can recreate the bind-mounted uploads directory as the host
  # user. The API runs as nodejs, so make the mounted tree writable before start.
  chown -R "$APP_UID:$APP_GID" "$UPLOADS_DIR"
  chmod -R u+rwX,g+rwX "$UPLOADS_DIR"

  exec su-exec "$APP_USER" "$@"
fi

exec "$@"
