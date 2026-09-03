#!/bin/sh
# Root launch daemon for SuperOne's opt-in closed-lid mode.
#
# The desktop app cannot override a Mac laptop's lid switch with a normal power
# assertion. This daemon owns the narrow system-wide `disablesleep` override and
# only keeps it active while all of these are true:
#   - the console user has a fresh SuperOne lease;
#   - the Mac is connected to AC power;
#   - this daemon is still healthy (launchd restarts it on failure).

set -eu

# Revision of this privileged pair (script + plist). The app reinstalls only
# when the copy it ships is NEWER than the installed one, so two SuperOne
# variants running different builds no longer overwrite each other's helper
# behind an admin prompt. Bump this on every change to this file OR to
# com.superone.lid-keep-awake.plist -- an unbumped edit will not be picked up.
SUPERONE_HELPER_VERSION=1

STATE_DIR="/var/db/com.superone.lid-keep-awake"
OWNED_FILE="$STATE_DIR/owned"
BORROWED_FILE="$STATE_DIR/borrowed"
LEASE_PREFIX="/private/tmp/com.superone.lid-keep-awake"
LEASE_MAX_AGE=30

/bin/mkdir -p "$STATE_DIR"
/bin/chmod 700 "$STATE_DIR"

sleep_is_disabled() {
  /usr/sbin/ioreg -r -c IOPMrootDomain -d 1 2>/dev/null \
    | /usr/bin/grep -Eq '"SleepDisabled" = (Yes|true|1)'
}

release_owned_override() {
  if [ -f "$OWNED_FILE" ]; then
    /usr/bin/pmset -a disablesleep 0 >/dev/null 2>&1 || true
    /bin/rm -f "$OWNED_FILE"
  fi
  /bin/rm -f "$BORROWED_FILE"
}

lease_file_is_fresh() {
  lease="$1"
  uid="$2"

  [ -f "$lease" ] || return 1
  [ ! -L "$lease" ] || return 1
  [ "$(/usr/bin/stat -f %u "$lease" 2>/dev/null || echo -1)" = "$uid" ] || return 1

  # The lease must not be writable by another user or group.
  mode="$(/usr/bin/stat -f %Lp "$lease" 2>/dev/null || echo 777)"
  case "$mode" in
    400|600) ;;
    *) return 1 ;;
  esac

  timestamp="$(/bin/cat "$lease" 2>/dev/null || true)"
  case "$timestamp" in
    ''|*[!0-9]*) return 1 ;;
  esac
  now="$(/bin/date +%s)"
  age=$((now - timestamp))
  [ "$age" -ge -5 ] && [ "$age" -le "$LEASE_MAX_AGE" ]
}

# Leases are per process (<prefix>.<uid>.<pid>.lease) so the side-by-side
# SuperOne variants cannot revoke each other's. Any fresh lease holds the
# override; expired ones are ignored and age out on their own.
lease_is_fresh() {
  uid="$1"
  for lease in "$LEASE_PREFIX.$uid."*.lease; do
    [ -e "$lease" ] || continue
    if lease_file_is_fresh "$lease" "$uid"; then
      return 0
    fi
  done
  return 1
}

console_user_has_fresh_lease() {
  uid="$(/usr/bin/stat -f %u /dev/console 2>/dev/null || echo 0)"
  [ "$uid" -ge 500 ] || return 1
  lease_is_fresh "$uid"
}

on_ac_power() {
  /usr/bin/pmset -g ps 2>/dev/null | /usr/bin/head -n 1 | /usr/bin/grep -q "AC Power"
}

acquire_override() {
  if [ -f "$OWNED_FILE" ]; then
    return
  fi

  # Do not undo another application's override when SuperOne later releases.
  if sleep_is_disabled; then
    /usr/bin/touch "$BORROWED_FILE"
    return
  fi

  /bin/rm -f "$BORROWED_FILE"
  # Record ownership before changing the global value so a launchd restart can
  # always clean up a partially completed acquisition.
  /usr/bin/touch "$OWNED_FILE"
  if ! /usr/bin/pmset -a disablesleep 1 >/dev/null 2>&1; then
    /bin/rm -f "$OWNED_FILE"
  fi
}

trap release_owned_override TERM INT HUP EXIT

while :; do
  if console_user_has_fresh_lease && on_ac_power; then
    # If another owner released while SuperOne was borrowing its override,
    # acquire our own without waiting for the next app lifecycle transition.
    if [ -f "$BORROWED_FILE" ] && ! sleep_is_disabled; then
      /bin/rm -f "$BORROWED_FILE"
    fi
    acquire_override
  else
    release_owned_override
  fi
  /bin/sleep 5
done
