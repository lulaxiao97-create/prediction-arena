#!/usr/bin/env python3
"""Print the current TOTP for an X 2FA secret: `<code> <seconds_left>`.

    python3 scripts/totp.py LP5PGJJXXZDLPB6N

Verified against the RFC 6238 SHA1 test vector (secret "12345678901234567890", t=59
→ 287082) before being trusted: a TOTP that is silently wrong looks exactly like a
wrong password, and on 2026-11-09 that cost 20 minutes of retrying.
"""
import base64
import hashlib
import hmac
import struct
import sys
import time


def totp(key: bytes, t: int, digits: int = 6) -> str:
    counter = t // 30
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] % 16
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] % 2147483648) % (10 ** digits)
    return str(value).zfill(digits)


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: totp.py <BASE32_SECRET>", file=sys.stderr)
        raise SystemExit(2)
    secret = sys.argv[1].replace(" ", "").upper().rstrip("=")
    key = base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8))
    now = int(time.time())
    print(f"{totp(key, now)} {30 - now % 30}")


if __name__ == "__main__":
    main()
