#!/bin/sh
set -eu
# Playwright creates the empty temporary profile as the trusted launcher UID.
# Transfer only that validated per-launch directory before dropping privileges.
for argument in "$@"; do
  case "$argument" in
    --user-data-dir=*)
      profile=${argument#--user-data-dir=}
      case "$profile" in
        /tmp/playwright_chromiumdev_profile-*)
          test -d "$profile" && test ! -L "$profile"
          chown 1101:1101 "$profile"
          chmod 700 "$profile"
          ;;
        *) exit 2 ;;
      esac
      ;;
  esac
done
exec setpriv --reuid=1101 --regid=1101 --init-groups --bounding-set=-all \
  env -i HOME=/tmp/browser PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  /opt/oddhound/chromium-real "$@"
