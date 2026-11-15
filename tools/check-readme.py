#!/usr/bin/env python3
"""Check a README before judges read it.

Catches what breaks silently: an image that renders locally and 404s on GitHub
because it was never committed, a link to a heading that got renamed, a CI
badge pointing at a workflow that does not exist, and the writing habits the
style rules forbid.

    python3 tools/check-readme.py                 # README.md in the repo root
    python3 tools/check-readme.py docs/setup.md
    python3 tools/check-readme.py --net           # also fetch external links

Exit 0 when only warnings, 1 when something is wrong.
"""

from __future__ import annotations

import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

args = [a for a in sys.argv[1:] if not a.startswith("--")]
CHECK_NET = "--net" in sys.argv
DOC = Path(args[0] if args else "README.md").resolve()
if not DOC.is_file():
    print(f"error: no such file: {DOC}", file=sys.stderr)
    sys.exit(1)

ROOT = Path(
    subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=DOC.parent,
                   capture_output=True, text=True).stdout.strip() or DOC.parent
)
TEXT = DOC.read_text(encoding="utf-8")
LINES = TEXT.splitlines()

errors: list[str] = []
warnings: list[str] = []


def err(line: int, msg: str) -> None:
    errors.append(f"{DOC.name}:{line}: {msg}")


def warn(line: int, msg: str) -> None:
    warnings.append(f"{DOC.name}:{line}: {msg}")


def line_of(pos: int) -> int:
    return TEXT.count("\n", 0, pos) + 1


# Files git knows about. An image that is on disk but not committed renders
# perfectly on your machine and is a broken image for everybody else, which is
# the single most common way a README breaks between "looks done" and "judged".
tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True)
TRACKED = {line for line in tracked.stdout.splitlines()} if tracked.returncode == 0 else None

MD_LINK = re.compile(r"(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
HTML_SRC = re.compile(r"<(?:img|source)[^>]*\ssrc=[\"']([^\"']+)[\"'][^>]*>", re.I)
HTML_HREF = re.compile(r"<a[^>]*\shref=[\"']([^\"']+)[\"'][^>]*>", re.I)
HTML_ALT = re.compile(r"\salt=[\"']([^\"']*)[\"']", re.I)


def slug(heading: str) -> str:
    """GitHub's heading anchor: lowercase, punctuation dropped, spaces to dashes."""
    text = re.sub(r"<[^>]+>", "", heading).strip()
    text = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s]+", "-", text).strip("-")


anchors = {slug(m.group(2)) for m in re.finditer(r"^(#{1,6})\s+(.*)$", TEXT, re.M)}
anchors |= set(re.findall(r'<a\s+(?:name|id)=["\']([^"\']+)["\']', TEXT, re.I))

# ------------------------------------------------------------------- targets


def check_target(pos: int, target: str, is_image: bool) -> None:
    line = line_of(pos)
    if target.startswith(("mailto:", "tel:")):
        return
    if target.startswith("#"):
        want = target[1:].lower()
        if want and want not in anchors:
            err(line, f"link to #{want}, which is not a heading in this file")
        return
    if target.startswith(("http://", "https://")):
        if CHECK_NET:
            try:
                req = Request(target, method="HEAD", headers={"User-Agent": "readme-check"})
                urlopen(req, timeout=10).close()
            except HTTPError as exc:
                if exc.code not in (403, 405, 999):   # sites that refuse HEAD or bots
                    err(line, f"{target} returned {exc.code}")
            except (URLError, OSError) as exc:
                warn(line, f"could not reach {target}: {exc}")
        if target.startswith("http://"):
            warn(line, f"http link, use https: {target}")
        return
    if target.startswith("/"):
        err(line, f"absolute path '{target}' breaks in forks and on clones, use a relative one")
        return

    path, _, _frag = target.partition("#")
    if not path:
        return
    resolved = (DOC.parent / path).resolve()
    if not resolved.exists():
        err(line, f"missing {'image' if is_image else 'file'}: {path}")
        return
    if TRACKED is not None:
        try:
            rel = resolved.relative_to(ROOT).as_posix()
        except ValueError:
            warn(line, f"{path} sits outside the repository")
            return
        if resolved.is_file() and rel not in TRACKED:
            err(line, f"{path} is not committed, so it will 404 on GitHub")
    if is_image and resolved.is_file():
        mb = resolved.stat().st_size / 1_048_576
        if mb > 3:
            warn(line, f"{path} is {mb:.1f}MB, compress it before judges load the page")


for m in MD_LINK.finditer(TEXT):
    is_image = m.group(1) == "!"
    if is_image and not m.group(2).strip():
        warn(line_of(m.start()), f"image with no alt text: {m.group(3)}")
    check_target(m.start(), m.group(3), is_image)

for m in HTML_SRC.finditer(TEXT):
    if not HTML_ALT.search(m.group(0)):
        warn(line_of(m.start()), f"<img> with no alt text: {m.group(1)}")
    check_target(m.start(), m.group(1), True)

for m in HTML_HREF.finditer(TEXT):
    check_target(m.start(), m.group(1), False)

# -------------------------------------------------------------------- badges

# The repo this README actually belongs to, so a badge copied from another
# project is caught rather than shipped pointing at somebody else's build.
remote = subprocess.run(["git", "remote", "get-url", "origin"], cwd=ROOT,
                        capture_output=True, text=True).stdout.strip()
ORIGIN = None
rm = re.search(r"github\.com[:/]([^/]+)/([^/.]+)", remote)
if rm:
    ORIGIN = (rm.group(1).lower(), rm.group(2).lower())

for m in re.finditer(r"https://github\.com/([^/]+)/([^/]+)/actions/workflows/([^/)\"]+)/badge\.svg", TEXT):
    owner, repo, workflow = m.groups()
    if ORIGIN and (owner.lower(), repo.lower()) != ORIGIN:
        err(line_of(m.start()),
            f"CI badge points at {owner}/{repo}, but this repo is {ORIGIN[0]}/{ORIGIN[1]}")
    if not any((ROOT / ".github" / "workflows" / f"{workflow}{ext}").is_file() for ext in ("", ".yml", ".yaml")):
        err(line_of(m.start()), f"CI badge points at .github/workflows/{workflow}, which does not exist")
    if "branch=" not in TEXT[m.end():m.end() + 40]:
        warn(line_of(m.start()),
             "CI badge has no ?branch= so it shows the newest run on any branch, which is not the one judges want")

# ------------------------------------------------------------------ the copy

for i, line in enumerate(LINES, 1):
    if "—" in line or "–" in line:
        err(i, "em or en dash, the style rules forbid both")

BANNED = re.compile(
    r"\b(delve|leverag\w*|utiliz\w*|robust|seamless\w*|effortless\w*|comprehensive|holistic"
    r"|streamlin\w*|cutting-edge|game-?chang\w*|revolutionar\w*|paradigm|synerg\w*|unlock\w*"
    r"|empower\w*|elevate|pivotal|crucial|testament)\b", re.I)
PLACEHOLDER = re.compile(r"\b(TODO|FIXME|TBD|Lorem ipsum|<your[- ]|YOUR_|xxx+)\b", re.I)

in_code = False
for i, line in enumerate(LINES, 1):
    if line.lstrip().startswith("```"):
        in_code = not in_code
        continue
    if in_code:
        continue
    found = BANNED.search(line)
    if found:
        warn(i, f"assistant vocabulary: '{found.group(0)}'")
    left = PLACEHOLDER.search(line)
    if left:
        err(i, f"placeholder left in: '{left.group(0)}'")
    head = re.match(r"^#{1,6}\s+(.*)$", line)
    if head:
        words = [w for w in re.findall(r"[A-Za-z][\w'-]*", head.group(1)) if len(w) > 3]
        caps = [w for w in words[1:] if w[0].isupper() and not w.isupper()]
        if len(words) > 2 and len(caps) >= len(words) - 1:
            warn(i, f"Title Case heading, the style rules want sentence case: '{head.group(1)}'")

# ------------------------------------------------------------------- the top

first_heading = next((i for i, line in enumerate(LINES, 1) if line.startswith("# ")), None)
if first_heading is None:
    warn(1, "no H1, so GitHub has no title to show")
head_block = "\n".join(LINES[:40])
if not re.search(r"!\[|<img", head_block):
    warn(1, "no image in the first 40 lines, judges see text only on the first screen")

print(f"checked {DOC.relative_to(ROOT) if DOC.is_relative_to(ROOT) else DOC}")
for w in warnings:
    print(f"  warn  {w}")
for e in errors:
    print(f"  !!    {e}")
print()
print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)
