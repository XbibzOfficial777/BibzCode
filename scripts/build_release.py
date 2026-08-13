#!/usr/bin/env python3
"""Build the deterministic CLI-only r6 archive and bind its hash to installer."""

from __future__ import annotations

import gzip
import hashlib
import io
import os
from pathlib import Path
import shutil
import tarfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE_ID = "7.8.0-r6"
ARCHIVE_NAME = f"deepseek-cli-{RELEASE_ID}.tar.gz"
RELEASE_DIR = ROOT / "releases"
ARCHIVE = RELEASE_DIR / ARCHIVE_NAME
CHECKSUM = RELEASE_DIR / f"{ARCHIVE_NAME}.sha256.txt"
INCLUDE_FILES = [
    ".gitignore", "README.md", "AGENTS.md", "SECURITY_AND_MIGRATION.md",
    "LICENSE", "pyproject.toml", "firebase-database.rules.json",
    "requirements.txt", "requirements-lock.txt",
    "requirements-optional.txt", "requirements-optional-lock.txt",
]


def source_files() -> list[Path]:
    files = [ROOT / name for name in INCLUDE_FILES]
    files.extend(sorted((ROOT / "deepseek").glob("*.py")))
    files.extend(sorted((ROOT / "tests").glob("test_*.py")))
    missing = [str(path) for path in files if not path.is_file()]
    if missing:
        raise SystemExit(f"release inputs missing: {missing}")
    return sorted(set(files), key=lambda path: str(path.relative_to(ROOT)))


def tar_bytes(files: list[Path]) -> bytes:
    output = io.BytesIO()
    release_root = f"deepseek-cli-{RELEASE_ID}"
    with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT) as tf:
        # Explicit root directory entry.
        root_info = tarfile.TarInfo(f"{release_root}/")
        root_info.type = tarfile.DIRTYPE
        root_info.mode = 0o755
        root_info.mtime = 0
        root_info.uid = root_info.gid = 0
        root_info.uname = root_info.gname = ""
        tf.addfile(root_info)
        for path in files:
            relative = path.relative_to(ROOT).as_posix()
            data = path.read_bytes()
            info = tarfile.TarInfo(f"{release_root}/{relative}")
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            tf.addfile(info, io.BytesIO(data))
    return output.getvalue()


def update_installer(expected_hash: str) -> None:
    installer = ROOT / "install.sh"
    text = installer.read_text()
    marker = 'EXPECTED_SHA256="'
    start = text.index(marker) + len(marker)
    end = text.index('"', start)
    current = text[start:end]
    if current != "__ARCHIVE_SHA256__" and len(current) != 64:
        raise SystemExit("installer EXPECTED_SHA256 has an unexpected value")
    installer.write_text(text[:start] + expected_hash + text[end:])
    installer.chmod(0o755)


def main() -> None:
    RELEASE_DIR.mkdir(parents=True, exist_ok=True)
    raw_tar = tar_bytes(source_files())
    with ARCHIVE.open("wb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=9) as gz:
            gz.write(raw_tar)
    digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
    CHECKSUM.write_text(f"{digest}  {ARCHIVE_NAME}\n")
    update_installer(digest)

    dashboard_public = ROOT / "dashboard-react" / "public"
    if dashboard_public.is_dir():
        (dashboard_public / "releases").mkdir(parents=True, exist_ok=True)
        (dashboard_public / "installers").mkdir(parents=True, exist_ok=True)
        shutil.copy2(ARCHIVE, dashboard_public / "releases" / ARCHIVE_NAME)
        shutil.copy2(CHECKSUM, dashboard_public / "releases" / CHECKSUM.name)
        shutil.copy2(ROOT / "install.sh", dashboard_public / "install.sh")
        shutil.copy2(ROOT / "install.sh", dashboard_public / "installers" / f"install-{RELEASE_ID}.sh")
    print(f"{ARCHIVE} {digest}")


if __name__ == "__main__":
    main()
