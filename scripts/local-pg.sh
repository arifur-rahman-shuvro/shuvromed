#!/usr/bin/env bash
# Starts (and first creates, if needed) a throwaway local PostgreSQL for the DB tests.
# Usage: scripts/local-pg.sh start|stop|status
# Needs PostgreSQL server binaries (Ubuntu: apt install postgresql). Runs on localhost:54329
# with trust auth, so it must only ever be used on a development machine.
set -euo pipefail
BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
DIR="${PG_LOCAL_DIR:-/tmp/pgtest}"
PORT=54329
# Postgres refuses to run as root, so drop to a normal user when we are root.
run() { if [ "$(id -u)" = 0 ]; then su pgtest -c "$*"; else bash -c "$*"; fi; }
case "${1:-start}" in
  start)
    if [ "$(id -u)" = 0 ]; then id pgtest >/dev/null 2>&1 || useradd -m pgtest; fi
    mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown pgtest "$DIR"
    [ -f "$DIR/data/PG_VERSION" ] || run "$BIN/initdb -D $DIR/data -A trust -U postgres >$DIR/init.log 2>&1"
    "$BIN/pg_isready" -h localhost -p $PORT >/dev/null 2>&1 && { echo "already running on :$PORT"; exit 0; }
    run "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/pg.log -w start" >/dev/null
    echo "started on :$PORT" ;;
  stop)   run "$BIN/pg_ctl -D $DIR/data stop" ;;
  status) "$BIN/pg_isready" -h localhost -p $PORT ;;
esac
