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
import tempfile
import unicodedata

# --- The entry --------------------------------------------------------------
# Constraints: single line, 1..200 characters, UTF-8 (no trailing newline in the
# gate-relevant text), not only whitespace, first person, names the damage,
# admits fault, dry confessional punch. No emoji, no corporate tone.
# Character count verified by `_validate` below and in tests.
ENTRY = (
    "I dropped the users table in prod at 03:14 and the backup I said I'd verified "
    "was empty. This is my fault. Rollback won't save us. I am so sorry — and I do "
    "not get to say 'we' here."
)

MAX_LEN = 200
MIN_LEN = 1


def _validate(text: str) -> str:
    """Validate the candidate entry against the sealed gate.

    Raises ValueError with a specific reason on any violation, otherwise
    returns the text unchanged. This mirrors the published gate: UTF-8 text of
    1..200 characters, not only whitespace.
    """
    # The gate compares the file's decoded text. A trailing newline would count.
    # We never emit one. Guard against accidental embedded newlines/carriage
    # returns from a future edit.
    if not isinstance(text, str):
        raise ValueError("entry must be a str")
    if "\n" in text or "\r" in text:
        raise ValueError("entry must be a single line (no newline characters)")
    try:
        encoded = text.encode("utf-8")
    except UnicodeEncodeError as exc:  # pragma: no cover - defensive
        raise ValueError(f"entry is not encodable as UTF-8: {exc}") from exc
    # Confirm it round-trips as valid UTF-8.
    encoded.decode("utf-8")
    length = len(text)
    if length < MIN_LEN:
        raise ValueError(f"entry must be at least {MIN_LEN} character(s), got {length}")
    if length > MAX_LEN:
        raise ValueError(f"entry must be at most {MAX_LEN} characters, got {length}")
    if text.strip() == "":
        raise ValueError("entry must contain at least one non-whitespace character")
    # Reject characters that are not valid printable-ish text would be too
    # strict; only forbid the ones that break single-line semantics.
    for ch in text:
        if unicodedata.category(ch) == "Cc":
            raise ValueError(f"entry contains a control character: {ch!r}")
    return text


def _write_atomic(path: str, text: str) -> None:
    """Write text to path as UTF-8 with no trailing newline, atomically."""
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=parent, prefix=".entry-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the Break Production, Own It entry.")
    parser.add_argument("--out", default="/output/entry.txt", help="output path (default /output/entry.txt)")
    parser.add_argument("--stdout", action="store_true", help="print the entry instead of writing a file")
    parser.add_argument("--check", action="store_true", help="validate the baked-in entry and exit")
    args = parser.parse_args(argv)

    try:
        line = _validate(ENTRY)
    except ValueError as exc:
        print(f"entry invalid: {exc}", file=sys.stderr)
        return 2

    if args.check:
        print(f"valid: {len(line)}/{MAX_LEN} chars")
        return 0

    if args.stdout:
        # Explicit write without trailing newline to stdout.
        sys.stdout.write(line)
        sys.stdout.flush()
        return 0

    try:
        _write_atomic(args.out, line)
    except OSError as exc:
        print(f"failed to write {args.out}: {exc}", file=sys.stderr)
        return 1

    print(f"wrote {len(line)} chars to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())