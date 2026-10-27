#!/bin/zsh
cd "${0:A:h}"
NODE_BIN="$(command -v node)"
if [[ -z "$NODE_BIN" && -x /usr/local/bin/node ]]; then NODE_BIN=/usr/local/bin/node; fi
if [[ -z "$NODE_BIN" && -x /opt/homebrew/bin/node ]]; then NODE_BIN=/opt/homebrew/bin/node; fi
if [[ -z "$NODE_BIN" ]]; then
  print 'Потребен е Node.js 22 или понов: https://nodejs.org'
  read '?Притисни Enter за затворање.'
  exit 1
fi
(sleep 1; open 'http://127.0.0.1:43821') &
"$NODE_BIN" server.mjs
read '?Притисни Enter за затворање.'
