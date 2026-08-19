'use strict';

// The optional @vscode/windows-ca-certs addon is not required for normal TLS.
// Returning no extra certificates preserves Node.js' default trust store and
// avoids making the IDE build depend on a platform-specific native addon.
class Crypt32 {
  next() {
    return undefined;
  }

  done() {}
}

module.exports = { Crypt32 };
