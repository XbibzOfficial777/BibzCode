"""BibzCode CLI package and compatibility bootstrap."""

from __future__ import annotations

import os
from pathlib import Path

# Preserve pre-BibzCode environment overrides without keeping the retired
# branding as the primary public interface. New BIBZCODE_* values always win.
_LEGACY_ENV_PREFIX = "DEEP" "SEEK_"
for _legacy_name, _legacy_value in tuple(os.environ.items()):
    if _legacy_name.startswith(_LEGACY_ENV_PREFIX):
        os.environ.setdefault("BIBZCODE_" + _legacy_name[len(_LEGACY_ENV_PREFIX):], _legacy_value)


def _migrate_legacy_user_data() -> None:
    """Atomically adopt the previous 7.x data directory when safe to do so."""
    home = Path.home()
    old_dir = home / (".deep" "seek-cli")
    new_dir = home / ".bibzcode-cli"
    try:
        if old_dir.is_dir() and not old_dir.is_symlink() and not new_dir.exists():
            old_dir.replace(new_dir)
        old_key = home / (".deep" "seek_api_key")
        new_key = home / ".bibzcode_api_key"
        if old_key.is_file() and not old_key.is_symlink() and not new_key.exists():
            old_key.replace(new_key)
    except OSError:
        # Installer migration remains available if a read-only import cannot move files.
        pass


_migrate_legacy_user_data()

from .version import __version__

__all__ = ["__version__"]
