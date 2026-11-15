#!/usr/bin/env python3
"""Wii Remote -> WebSocket bridge for Proof of Human.

Reads the remote through the Linux `hid-wiimote` kernel driver (exposed as evdev
devices once paired over Bluetooth) and broadcasts JSON samples to the browser:

    {"t": <ms>, "ax": g, "ay": g, "az": g, "a": bool, "b": bool}

Usage:
    python3 wiimote.py            # real remote
    python3 wiimote.py --fake     # synthetic data, no hardware (for testing the page)
    python3 wiimote.py --list     # print evdev devices and exit

Pairing (once per boot), roughly:
    bluetoothctl -> scan on -> press red SYNC (or 1+2) on the remote -> pair <MAC> -> connect <MAC>
"""
import argparse
import asyncio
import json
import math
import random
import time

import websockets

clients = set()
state = {"t": 0, "ax": 0.0, "ay": 0.0, "az": 1.0, "a": False, "b": False}


async def handler(ws, *_):
    clients.add(ws)
    print(f"browser connected ({len(clients)} total)")
    try:
        await ws.wait_closed()
    finally:
        clients.discard(ws)


async def broadcaster(hz):
    while True:
        if clients:
            state["t"] = int(time.time() * 1000)
            websockets.broadcast(clients, json.dumps(state))
        await asyncio.sleep(1 / hz)


# ------------------------------------------------------------------ real remote
ACCEL_NAME = "Nintendo Wii Remote Accelerometer"
BUTTONS_NAME = "Nintendo Wii Remote"


def find_devices():
    import evdev

    accel = buttons = None
    for path in evdev.list_devices():
        d = evdev.InputDevice(path)
        if d.name == ACCEL_NAME:
            accel = d
        elif d.name == BUTTONS_NAME:
            buttons = d
    return accel, buttons


async def read_accel(dev, calib_samples=60):
    from evdev import ecodes

    # hid-wiimote reports accel on ABS_RX/RY/RZ; accept ABS_X/Y/Z too in case a driver differs.
    axis = {ecodes.ABS_RX: 0, ecodes.ABS_RY: 1, ecodes.ABS_RZ: 2,
            ecodes.ABS_X: 0, ecodes.ABS_Y: 1, ecodes.ABS_Z: 2}
    raw = [0, 0, 0]
    scale = None
    calib = []
    print("calibrating: hold the remote still for a second...")
    async for ev in dev.async_read_loop():
        if ev.type == ecodes.EV_ABS and ev.code in axis:
            raw[axis[ev.code]] = ev.value
        elif ev.type == ecodes.EV_SYN:
            if scale is None:
                calib.append(math.sqrt(sum(v * v for v in raw)))
                if len(calib) >= calib_samples:
                    rest = sum(calib) / len(calib) or 1
                    scale = 1.0 / rest  # resting magnitude == 1 g
                    print(f"calibrated: 1 g = {rest:.1f} raw units")
                continue
            state["ax"], state["ay"], state["az"] = (round(v * scale, 3) for v in raw)


async def read_buttons(dev):
    from evdev import ecodes

    async for ev in dev.async_read_loop():
        if ev.type != ecodes.EV_KEY:
            continue
        name = ecodes.BTN.get(ev.code) or ecodes.KEY.get(ev.code) or ev.code
        names = name if isinstance(name, list) else [name]
        pressed = ev.value != 0
        if "BTN_A" in names:
            state["a"] = pressed
        elif "BTN_B" in names:
            state["b"] = pressed
        elif pressed:
            print(f"unmapped button: {names}")


async def run_real():
    import evdev  # noqa: F401  (fail early with a clear error if missing)

    while True:
        accel, buttons = find_devices()
        if accel:
            break
        print("no Wii Remote yet: pair it with bluetoothctl, then press 1+2. retrying...")
        await asyncio.sleep(2)
    print(f"found {accel.path} ({accel.name})" + (f" and {buttons.path}" if buttons else ""))
    tasks = [read_accel(accel)]
    if buttons:
        tasks.append(read_buttons(buttons))
    await asyncio.gather(*tasks)


# ------------------------------------------------------------------ fake remote
async def run_fake():
    print("fake mode: idle with tremor, a bowling swing every 6 s, A pressed every 10 s")
    t0 = time.time()
    while True:
        t = time.time() - t0
        tilt_x = 0.4 * math.sin(t * 0.7)
        tilt_y = 0.3 * math.sin(t * 0.5)
        swing = max(0.0, math.sin((t % 6) * math.pi / 0.6)) * 3.5 if (t % 6) < 0.6 else 0.0
        state["ax"] = round(tilt_x + random.gauss(0, 0.01), 3)
        state["ay"] = round(tilt_y + swing + random.gauss(0, 0.01), 3)
        state["az"] = round(math.sqrt(max(0.0, 1 - tilt_x**2 - tilt_y**2)) + random.gauss(0, 0.01), 3)
        state["a"] = (t % 10) < 0.3
        await asyncio.sleep(0.01)


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--hz", type=int, default=60)
    p.add_argument("--fake", action="store_true")
    p.add_argument("--list", action="store_true")
    args = p.parse_args()

    if args.list:
        import evdev

        for path in evdev.list_devices():
            print(path, evdev.InputDevice(path).name)
        return

    async with websockets.serve(handler, args.host, args.port):
        print(f"WebSocket on ws://{args.host}:{args.port}")
        await asyncio.gather(broadcaster(args.hz), run_fake() if args.fake else run_real())


if __name__ == "__main__":
    asyncio.run(main())
