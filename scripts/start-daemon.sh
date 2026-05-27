#!/bin/bash
# Wrapper used by launchd (com.ryzewith.qaagent.plist) to start the runner
# daemon. Insulates the daemon from NVM path changes by sourcing nvm.sh
# at launch time, so a node upgrade doesn't break the plist.

set -e

# Restrict file-creation mode so daemon log rotations + any artifacts written
# inherit 600/700 perms. Log files contain audit URLs and may include scraped
# cookies/tokens — keep them user-only.
umask 077

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
fi

cd "$HOME/Claude Code/QA Agent"
exec npm run daemon
