#!/usr/bin/env python3
"""Генерация иконок расширения (16/32/48/128) без внешних зависимостей.

Рисует белый колокольчик на синем скруглённом квадрате с 4x суперсэмплингом.
Запуск:  python3 tools/make_icons.py
"""

import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
SIZES = (16, 32, 48, 128)
SS = 4  # коэффициент суперсэмплинга

BG_TOP = (37, 99, 235)   # #2563eb
BG_BOTTOM = (29, 78, 216)  # #1d4ed8
FG = (255, 255, 255)


def write_png(path, width, height, rows):
    """rows: список bytes длиной width*4 (RGBA) на каждую строку."""
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    blob = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as fh:
        fh.write(blob)


def in_rounded_square(x, y, half, radius):
    ax, ay = abs(x), abs(y)
    if ax > half or ay > half:
        return False
    if ax <= half - radius or ay <= half - radius:
        return True
    dx, dy = ax - (half - radius), ay - (half - radius)
    return dx * dx + dy * dy <= radius * radius


def in_bell(x, y):
    """Колокольчик в нормализованных координатах [-1, 1]."""
    if x * x + (y + 0.46) ** 2 <= 0.09 ** 2:          # головка
        return True
    if y <= -0.08:                                     # купол
        return (x / 0.34) ** 2 + ((y + 0.08) / 0.34) ** 2 <= 1.0
    if y <= 0.20:                                      # раструб
        w = 0.34 + 0.20 * ((y + 0.08) / 0.28) ** 2
        return abs(x) <= w
    if y <= 0.26:                                      # кромка
        return abs(x) <= 0.54
    return x * x + (y - 0.40) ** 2 <= 0.13 ** 2        # язычок


def render(size):
    n = size * SS
    half = 1.0 - 1.0 / n            # нормализованный полуразмер
    radius = 0.44                    # скругление углов
    acc = [[[0, 0, 0, 0] for _ in range(size)] for _ in range(size)]

    for py in range(n):
        y = (py + 0.5) / n * 2 - 1
        row = acc[py // SS]
        for px in range(n):
            x = (px + 0.5) / n * 2 - 1
            if not in_rounded_square(x, y, half, radius):
                continue
            t = max(0.0, min(1.0, (x + y + 2) / 4))   # диагональный градиент
            cell = row[px // SS]
            cell[3] += 255
            if in_bell(x, y):
                cell[0] += FG[0]; cell[1] += FG[1]; cell[2] += FG[2]
            else:
                cell[0] += BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t
                cell[1] += BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t
                cell[2] += BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t

    samples = SS * SS
    rows = []
    for y in range(size):
        line = bytearray()
        for x in range(size):
            r, g, b, a = acc[y][x]
            if a <= 0:
                line += b"\x00\x00\x00\x00"
                continue
            # цвет усредняем по покрытым сэмплам, альфу — по всем
            covered = a / 255.0
            alpha = round(a / samples)
            line += bytes((
                min(255, round(r / covered)),
                min(255, round(g / covered)),
                min(255, round(b / covered)),
                min(255, alpha),
            ))
        rows.append(bytes(line))
    return rows


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(path, size, size, render(size))
        print(f"{path}  {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
