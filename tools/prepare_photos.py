#!/usr/bin/env python3
"""Turn photos of clothes into cutouts the pile can use.

Put photos in photos/ (any of .jpg .jpeg .heic .png). A subfolder named after a bag
(everyday, fabrics, outerwear) puts the piece in that bag; anything else goes to "everyday".
The file name becomes the piece's name ("Plaid shirt.jpg" → "Plaid shirt"); camera names
like IMG_1234 become "Piece N".

    python3 tools/prepare_photos.py

For each new photo this:
  1. lifts the piece off the floor with macOS subject lifting (tools/cutout.swift);
     a PNG that already has a transparent background is used as it is,
  2. shrinks it to 900 px and saves a transparent WebP in assets/clothes/,
  3. adds it to assets/clothes/clothes.json (edit names/bags there; reruns keep your edits),
  4. rewrites assets/clothes/manifest.js, which the app loads.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHOTOS = ROOT / "photos"
OUT = ROOT / "assets" / "clothes"
CACHE = ROOT / ".cache"
CATALOG = OUT / "clothes.json"
MANIFEST = OUT / "manifest.js"
BAGS = {"everyday", "fabrics", "outerwear", "occasion"}
CAMERA_NAME = re.compile(r"^(img|dsc|pxl|photo|pexels)[-_ ]?\d", re.I)
ALPHA_FORMATS = {"rgba", "ya8", "rgba64be", "rgba64le", "ya16be", "ya16le"}
EXTS = {".jpg", ".jpeg", ".heic", ".png"}
MAX_SIDE = 900


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "piece"


def build_cutout_tool():
    CACHE.mkdir(exist_ok=True)
    binary = CACHE / "cutout"
    source = ROOT / "tools" / "cutout.swift"
    if not binary.exists() or binary.stat().st_mtime < source.stat().st_mtime:
        print("Building the cutout tool (once)…")
        subprocess.run(["swiftc", "-O", str(source), "-o", str(binary)], check=True)
    return binary


def has_alpha(path):
    if path.suffix.lower() != ".png":
        return False
    fmt = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True).stdout.strip()
    return fmt in ALPHA_FORMATS


def piece_name(stem, number):
    if CAMERA_NAME.match(stem):
        return f"Piece {number}"
    name = re.sub(r"_+", " ", stem).strip()
    return name[:1].upper() + name[1:] if name else f"Piece {number}"


def image_size(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = out.split(",")[:2]
    return int(w), int(h)


def main():
    if not PHOTOS.exists():
        PHOTOS.mkdir()
        print("Made photos/. Put your photos in it and run this again.")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CATALOG.read_text()) if CATALOG.exists() else []
    known = {entry["source"] for entry in catalog}
    used_ids = {entry["id"] for entry in catalog}

    todo = []
    for photo in sorted(PHOTOS.rglob("*")):
        if photo.suffix.lower() not in EXTS or not photo.is_file():
            continue
        rel = photo.relative_to(PHOTOS).as_posix()
        if rel in known:
            continue
        folder = photo.parent.name.lower() if photo.parent != PHOTOS else ""
        bag = folder if folder in BAGS else "everyday"
        base = slugify(photo.stem)
        pid, n = base, 2
        while pid in used_ids:
            pid, n = f"{base}-{n}", n + 1
        used_ids.add(pid)
        todo.append((photo, rel, bag, pid))

    if todo:
        with tempfile.TemporaryDirectory() as tmp:
            args = []
            for photo, _, _, pid in todo:
                if not has_alpha(photo):
                    args += [str(photo), str(Path(tmp) / f"{pid}.png")]
            if args:
                result = subprocess.run([str(build_cutout_tool()), *args], capture_output=True, text=True)
                print(result.stdout.strip())
            for photo, rel, bag, pid in todo:
                cut = photo if has_alpha(photo) else Path(tmp) / f"{pid}.png"
                if not cut.exists():
                    print(f"  skipped {rel}: no piece found in the photo")
                    continue
                dest = OUT / f"{pid}.webp"
                subprocess.run([
                    "ffmpeg", "-v", "error", "-y", "-i", str(cut),
                    "-vf", f"scale='if(gt(iw,ih),min({MAX_SIDE},iw),-2)':'if(gt(iw,ih),-2,min({MAX_SIDE},ih))'",
                    "-c:v", "libwebp", "-quality", "82", "-pix_fmt", "yuva420p", str(dest)], check=True)
                w, h = image_size(dest)
                number = len(catalog) + 1
                catalog.append({
                    "id": pid, "source": rel, "file": f"assets/clothes/{pid}.webp",
                    "w": w, "h": h, "name": piece_name(photo.stem, number), "bag": bag, "fabric": "", "size": ""})
                print(f"  added {rel} → {dest.name} ({w}×{h}, {bag})")

    # Drop entries whose cutout was deleted
    catalog = [e for e in catalog if (ROOT / e["file"]).exists()]
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")
    public = [{k: e[k] for k in ("id", "file", "w", "h", "name", "bag", "fabric", "size")} for e in catalog]
    MANIFEST.write_text("/* Generated by tools/prepare_photos.py. Edit clothes.json, then rerun. */\n"
                        f"window.RUMMAGE_PHOTOS = {json.dumps(public, indent=2, ensure_ascii=False)};\n")
    print(f"{len(catalog)} pieces in assets/clothes/manifest.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
