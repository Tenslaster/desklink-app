#!/usr/bin/env python3
"""Patch vendored image-size against ICNS/HEIF/JXL infinite-loop DoS (GHSA)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "vendor" / "image-size-patched"


def patch_text(t: str) -> str:
    t = t.replace(
        "images.push(imageSize);\n      imageOffset += imageHeader[1];",
        "images.push(imageSize);\n"
        "      const entryLen = imageHeader[1];\n"
        "      if (!(entryLen > 0)) {\n"
        '        throw new TypeError("Invalid ICNS, zero-length entry");\n'
        "      }\n"
        "      imageOffset += entryLen;",
    )
    t = t.replace(
        "images.push({ height, width });\n      currentOffset = ispeBox.offset + ispeBox.size;",
        "images.push({ height, width });\n"
        "      if (!(ispeBox.size > 0)) {\n"
        '        throw new TypeError("Invalid HEIF, zero-size ispe box");\n'
        "      }\n"
        "      currentOffset = ispeBox.offset + ispeBox.size;",
    )
    t = t.replace(
        "partialStreams.push(\n      input.slice(jxlpBox.offset + 12, jxlpBox.offset + jxlpBox.size)",
        "if (!(jxlpBox.size > 12)) {\n"
        '      throw new TypeError("Invalid JXL, zero-size jxlp box");\n'
        "    }\n"
        "    partialStreams.push(\n"
        "      input.slice(jxlpBox.offset + 12, jxlpBox.offset + jxlpBox.size)",
    )
    return t


def main() -> int:
    if not ROOT.is_dir():
        print("missing", ROOT)
        return 1
    n = 0
    for p in ROOT.rglob("*"):
        if p.suffix not in {".cjs", ".mjs", ".js"} or not p.is_file():
            continue
        orig = p.read_text(encoding="utf-8")
        new = patch_text(orig)
        if new != orig:
            p.write_text(new, encoding="utf-8")
            n += 1
            print("patched", p.relative_to(ROOT))
    pkg_path = ROOT / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
    pkg["version"] = "2.0.3-desklink.1"
    pkg["name"] = "image-size"
    pkg["description"] = (
        "image-size 2.0.2 + DoS guards for ICNS/HEIF/JXL "
        "(DeskLink security patch; upstream repo archived)"
    )
    pkg_path.write_text(json.dumps(pkg, indent=2) + "\n", encoding="utf-8")
    print("files_patched", n, "version", pkg["version"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
