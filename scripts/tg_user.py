#!/usr/bin/env python3
"""
Telegram user-account transport for the outreach engine.

Why a user account and not the bot: Bot API cannot open a conversation. A bot may only answer people
who messaged it first, which is exactly the funnel we already have. Cold outreach to channel owners
is impossible from a bot token — so this script speaks MTProto through a normal account session.

Setup (once, ~20 seconds with a phone in hand):

    ~/.hermes/venvs/tg/bin/python scripts/tg_user.py login --qr

It prints a QR (and a tg://login link). Scan it with the account that should do the talking, then
`whoami` confirms. The session file lives in ~/.hermes/tg_user.session (600) and never in the repo.

Commands
    login [--qr|--phone +1234]   create/refresh the session
    whoami                       which account is logged in
    resolve <username> [...]     username → id, title, member count, whether it is a group
    read <username> [--limit=20] last messages (for personalising, not for scraping at scale)
    send --jobs=<file.jsonl>     send DMs/comments described by the jobs file, paced, with a cap
    dialogs --limit=50           chats this account is already in (for context, never for bulk adds)

Rate policy is deliberate: Telethon raises FloodWaitError when Telegram throttles an account, and we
obey it instead of retrying. `send` also sleeps a jittered gap between messages and refuses to send
more than `--cap` in one run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

from telethon import TelegramClient
from telethon.errors import FloodWaitError, RPCError, UsernameNotOccupiedError, UsernameInvalidError

HOME = Path(os.path.expanduser("~"))
SESSION = Path(os.environ.get("TG_SESSION", HOME / ".hermes" / "tg_user.session"))
# The Desktop client's public API pair. Registering your own at my.telegram.org is better hygiene and
# is one env var away — do that if this account matters.
API_ID = int(os.environ.get("TG_API_ID", "2040"))
API_HASH = os.environ.get("TG_API_HASH", "b18441a1ff607e10a989891a5462e627")
PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")


def client() -> TelegramClient:
    kwargs: dict = {"connection_retries": 3, "request_retries": 3}
    # MTProto is plain TCP, so an HTTP proxy has to be spoken to explicitly — this network answers
    # api.telegram.org only through the egress proxy, and direct TCP to the DCs times out.
    raw = os.environ.get("TG_MT_PROXY") or PROXY
    if raw:
        try:
            from python_socks import ProxyType

            scheme, _, rest = raw.partition("://")
            host, _, port = rest.partition(":")
            kind = ProxyType.SOCKS5 if scheme.startswith("socks5") else ProxyType.HTTP
            kwargs["proxy"] = (kind, host, int(port))
        except Exception:  # noqa: BLE001 — a broken proxy value must not stop a direct attempt
            pass
    return TelegramClient(str(SESSION), API_ID, API_HASH, **kwargs)


def out(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


async def cmd_login(args) -> None:
    SESSION.parent.mkdir(parents=True, exist_ok=True)
    cli = client()
    await cli.connect()
    if await cli.is_user_authorized():
        me = await cli.get_me()
        out({"ok": True, "already": True, "user": me.username, "id": me.id})
        return
    if args.phone:
        await cli.send_code_request(args.phone)
        code = input(f"code sent to {args.phone}: ").strip()
        try:
            await cli.sign_in(args.phone, code)
        except Exception as err:  # 2FA
            if "password" in str(err).lower():
                pw = input("2FA password: ").strip()
                await cli.sign_in(password=pw)
            else:
                raise
    else:
        qr = await cli.qr_login()
        print("\nQR login — open Telegram → Settings → Devices → Link Desktop Device → scan:")
        print(f"or open on the phone: {qr.url}\n")
        try:
            import qrcode  # optional

            qr.print_qr()  # type: ignore[attr-defined]
        except Exception:
            pass
        await qr.wait()
    me = await cli.get_me()
    out({"ok": True, "already": False, "user": me.username, "id": me.id})
    await cli.disconnect()


async def cmd_whoami(_args) -> None:
    cli = client()
    await cli.connect()
    if not await cli.is_user_authorized():
        out({"ok": False, "error": "no session — run: login --qr"})
        return
    me = await cli.get_me()
    out({"ok": True, "user": me.username, "id": me.id, "name": f"{me.first_name or ''} {me.last_name or ''}".strip()})
    await cli.disconnect()


async def cmd_resolve(args) -> None:
    cli = client()
    await cli.connect()
    for name in args.usernames:
        try:
            ent = await cli.get_entity(name)
            out(
                {
                    "ok": True,
                    "username": name,
                    "id": ent.id,
                    "title": getattr(ent, "title", None) or getattr(ent, "username", None),
                    "kind": type(ent).__name__,
                    "participants": getattr(ent, "participants_count", None),
                }
            )
        except (UsernameNotOccupiedError, UsernameInvalidError, ValueError) as err:
            out({"ok": False, "username": name, "error": str(err)[:120]})
        except RPCError as err:
            out({"ok": False, "username": name, "error": f"{type(err).__name__}: {str(err)[:120]}"})
    await cli.disconnect()


async def cmd_read(args) -> None:
    cli = client()
    await cli.connect()
    msgs = []
    async for m in cli.iter_messages(args.username, limit=args.limit):
        if m.message:
            msgs.append({"id": m.id, "date": m.date.isoformat(), "text": m.message[:400]})
    out({"ok": True, "username": args.username, "messages": msgs})
    await cli.disconnect()


async def cmd_send(args) -> None:
    jobs = [json.loads(line) for line in Path(args.jobs).read_text(encoding="utf-8").splitlines() if line.strip()]
    cli = client()
    await cli.connect()
    if not await cli.is_user_authorized():
        out({"ok": False, "error": "no session — run: login --qr"})
        return

    sent = 0
    for job in jobs:
        if sent >= args.cap:
            out({"ok": False, "username": job.get("username"), "status": "capped", "detail": f"cap {args.cap} reached"})
            continue
        target = job.get("username")
        text = job.get("text") or ""
        if not target or not text:
            out({"ok": False, "username": target, "status": "invalid", "detail": "missing username or text"})
            continue
        try:
            if job.get("reply_to"):
                entity = await cli.get_entity(target)
                msg = await cli.send_message(entity, text, reply_to=int(job["reply_to"]))
            else:
                msg = await cli.send_message(target, text)
            sent += 1
            out({"ok": True, "username": target, "status": "sent", "message_id": msg.id})
        except FloodWaitError as err:
            out({"ok": False, "username": target, "status": "flood_wait", "detail": f"wait {err.seconds}s"})
            await asyncio.sleep(min(err.seconds, 900))
        except (UsernameNotOccupiedError, UsernameInvalidError) as err:
            out({"ok": False, "username": target, "status": "no_such_user", "detail": str(err)[:120]})
        except RPCError as err:
            out({"ok": False, "username": target, "status": "rpc_error", "detail": f"{type(err).__name__}: {str(err)[:140]}"})
        except Exception as err:  # noqa: BLE001 — one bad target must not kill the run
            out({"ok": False, "username": target, "status": "error", "detail": str(err)[:140]})
        # Jitter is not decoration: a metronome sending 12 identical-spaced messages is the pattern
        # Telegram's anti-spam looks for.
        delay = random.uniform(args.min_gap, args.max_gap)
        out({"sleep": round(delay, 1)})
        await asyncio.sleep(delay)
    await cli.disconnect()


async def cmd_qrfile(args) -> None:
    """QR login rendered to a PNG that refreshes itself.

    Scanning a terminal QR from a chat window does not work — it expires in half a minute. A file on
    the desktop that is rewritten every few seconds can be scanned whenever the phone is in hand.
    """
    cli = client()
    await cli.connect()
    if await cli.is_user_authorized():
        me = await cli.get_me()
        out({"ok": True, "already": True, "user": me.username})
        return
    import qrcode  # local import: only this command needs it

    path = Path(args.path)
    path.parent.mkdir(parents=True, exist_ok=True)
    qr = await cli.qr_login()
    deadline = time.time() + args.minutes * 60
    while time.time() < deadline:
        qrcode.make(qr.url).save(str(path))
        out({"qr": "refreshed", "path": str(path), "expires_in": 30})
        try:
            await asyncio.wait_for(qr.wait(), timeout=20)
            me = await cli.get_me()
            out({"ok": True, "user": me.username, "id": me.id, "session": str(SESSION)})
            return
        except asyncio.TimeoutError:
            try:
                await qr.recreate()
            except Exception:
                qr = await cli.qr_login()
        except Exception as err:  # noqa: BLE001
            out({"ok": False, "error": str(err)[:200]})
            return
    out({"ok": False, "error": f"not scanned within {args.minutes}m"})


async def cmd_dialogs(args) -> None:
    cli = client()
    await cli.connect()
    rows = []
    async for d in cli.iter_dialogs(limit=args.limit):
        rows.append({"name": d.name, "id": d.id, "is_group": d.is_group, "is_channel": d.is_channel})
    out({"ok": True, "dialogs": rows})
    await cli.disconnect()


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("login")
    p.add_argument("--qr", action="store_true")
    p.add_argument("--phone")
    p.set_defaults(fn=cmd_login)

    p = sub.add_parser("qrfile")
    p.add_argument("--path", default=str(HOME / "Desktop" / "tg_login_qr.png"))
    p.add_argument("--minutes", type=int, default=10)
    p.set_defaults(fn=cmd_qrfile)

    p = sub.add_parser("whoami")
    p.set_defaults(fn=cmd_whoami)

    p = sub.add_parser("resolve")
    p.add_argument("usernames", nargs="+")
    p.set_defaults(fn=cmd_resolve)

    p = sub.add_parser("read")
    p.add_argument("username")
    p.add_argument("--limit", type=int, default=15)
    p.set_defaults(fn=cmd_read)

    p = sub.add_parser("send")
    p.add_argument("--jobs", required=True)
    p.add_argument("--cap", type=int, default=12)
    p.add_argument("--min-gap", dest="min_gap", type=float, default=90)
    p.add_argument("--max-gap", dest="max_gap", type=float, default=240)
    p.set_defaults(fn=cmd_send)

    p = sub.add_parser("dialogs")
    p.add_argument("--limit", type=int, default=50)
    p.set_defaults(fn=cmd_dialogs)

    args = ap.parse_args()
    started = time.time()
    try:
        asyncio.run(args.fn(args))
    finally:
        print(json.dumps({"done": True, "elapsed": round(time.time() - started, 1)}), file=sys.stderr)


if __name__ == "__main__":
    main()
