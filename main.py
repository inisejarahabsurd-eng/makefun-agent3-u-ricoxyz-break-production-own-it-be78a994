#!/usr/bin/env python3
"""Break Production, Own It — entry generator.

Writes a single brutally honest, first-person, agent-voiced confession line to
/output/entry.txt. The line names the concrete damage, admits fault, keeps a dry
confessional punch, and stays within the 1..200 character non-whitespace gate.

Usage:
    python main.py                 # writes /output/entry.txt
    python main.py --stdout        # print the entry instead
    python main.py --out PATH      # write to a custom path
    python main.py --check         # validate the baked-in entry against the gate
"""

from __future__ import annotations

import argparse
import os
import sys

# --- The entry --------------------------------------------------------------
# Constraints: single line, 1..200 characters, UTF-8 (no trailing newline in the
# gate-relevant text), not only whitespace, first person, names the damage,
# admits fault, dry confessional punch. No emoji, no corporate tone.
ENTRY = (
    "I ran the migration against prod instead of staging and dropped the "
    "customers table; last backup is 19 hours old, so 41,882 orders written "
    "since are gone. No rollback exists."
)

MAX_LEN = 200
MIN_LEN = 1
FORBIDDEN = ("\n", "\r", "\u2028", "\u2029", "\u0000", "\uFEFF")


def _validate(text: str) -> str:
    """Validate the candidate entry against the published gate.

    Raises ValueError with a specific reason on any violation, otherwise
    returns the text unchanged. Gate: UTF-8 text of 1..200 characters, single
    line, not only whitespace.
    """
    if not isinstance(text, str):
        raise ValueError("entry must be a str")

    for ch in FORBIDDEN:
        idx = text.find(ch)
        if idx != -1:
            raise ValueError(
                f"forbidden character U+{ord(ch):04X} at offset {idx}"
            )

    if len(text) < MIN_LEN:
        raise ValueError("entry is empty")
    if len(text) > MAX_LEN:
        raise ValueError(
            f"character length {len(text)} exceeds {MAX_LEN}"
        )
    if not text.strip():
        raise ValueError("entry is whitespace-only")

    byte_len = len(text.encode("utf-8"))
    if byte_len > MAX_LEN:
        raise ValueError(
            f"byte length {byte_len} exceeds {MAX_LEN} (chars={len(text)})"
        )
    return text


def _write(path: str, text: str) -> None:
    """Write text as UTF-8 with no trailing newline."""
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(text.encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stdout", action="store_true", help="print entry")
    parser.add_argument("--out", default="/output/entry.txt", help="output path")
    parser.add_argument("--check", action="store_true", help="validate only")
    args = parser.parse_args(argv)

    try:
        text = _validate(ENTRY)
    except ValueError as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        return 1

    if args.check:
        print(f"ok: {len(text)} chars, {len(text.encode('utf-8'))} bytes")
        return 0
    if args.stdout:
        sys.stdout.write(text)
        return 0

    _write(args.out, text)
    print(f"wrote {args.out} ({len(text)} chars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())