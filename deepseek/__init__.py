"""Compatibility package for installations created before the BibzCode rename."""

from pathlib import Path

import bibzcode as _bibzcode
from bibzcode import __version__

# Resolve legacy submodule imports from the canonical BibzCode package while
# retaining this directory first so ``python -m`` uses the wrapper below.
__path__ = [
    str(Path(__file__).resolve().parent),
    str(Path(_bibzcode.__file__).resolve().parent),
]

__all__ = ["__version__"]
