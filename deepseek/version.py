"""Single source of truth for DeepSeek CLI release metadata."""

BASE_VERSION = "7.8.0"
RELEASE_REVISION = 6
RELEASE_CHANNEL = "nightly"
RELEASE_ID = f"{BASE_VERSION}-r{RELEASE_REVISION}"

# User-facing/runtime version. Packaging uses the PEP 440 equivalent
# 7.8.0.post6 in pyproject.toml.
__version__ = RELEASE_ID
__package_version__ = f"{BASE_VERSION}.post{RELEASE_REVISION}"
