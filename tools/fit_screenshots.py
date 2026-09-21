#!/usr/bin/env python3
"""Приведение скриншотов к 1280x800: масштаб «по вписыванию» + поля по краям.

Требование Chrome Web Store к скриншотам — ровно 1280x800 или 640x400 px.
Кадры меньше канваса центрируются на нём; цвет полей берётся как самый частый
цвет рамки самого скриншота, чтобы поля сливались с ним.

Исходники не изменяются: результат пишется в screen_shots/store/.

Запуск:
    python3 tools/fit_screenshots.py --dry-run   # только показать расчёт
    python3 tools/fit_screenshots.py             # записать файлы
"""

import collections
import glob
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, "screen_shots")
DST_DIR = os.path.join(SRC_DIR, "store")
CANVAS = (1280, 800)


# ---------------------------------------------------------------- декодер PNG

def _unfilter(raw, width, height, bpp, stride):
    out = bytearray(stride * height)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype == 0:
            pass
        elif ftype == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                up = prev[i]
                upleft = prev[i - bpp] if i >= bpp else 0
                p = left + up - upleft
                pa, pb, pc = abs(p - left), abs(p - up), abs(p - upleft)
                if pa <= pb and pa <= pc:
                    pred = left
                elif pb <= pc:
                    pred = up
                else:
                    pred = upleft
                line[i] = (line[i] + pred) & 0xFF
        else:
            raise ValueError(f"неизвестный фильтр PNG: {ftype}")
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return out


def decode_png(path):
    """Возвращает (width, height, bytearray RGB), поддерживая 8-битные gray/RGB/RGBA/palette."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: не PNG")

    pos, idat, palette, header = 8, bytearray(), None, None
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        crc = struct.unpack(">I", data[pos + 8 + length:pos + 12 + length])[0]
        if (zlib.crc32(tag + body) & 0xFFFFFFFF) != crc:
            raise ValueError(f"{path}: повреждён чанк {tag!r} (CRC)")
        if tag == b"IHDR":
            header = struct.unpack(">IIBBBBB", body)
        elif tag == b"PLTE":
            palette = body
        elif tag == b"IDAT":
            idat += body
        pos += 12 + length

    width, height, depth, color, _comp, _filt, interlace = header
    if depth != 8:
        raise ValueError(f"{path}: поддерживается только 8 бит на канал (получено {depth})")
    if interlace != 0:
        raise ValueError(f"{path}: Adam7-interlace не поддерживается")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color)
    if channels is None:
        raise ValueError(f"{path}: неизвестный тип цвета {color}")

    stride = width * channels
    flat = _unfilter(zlib.decompress(bytes(idat)), width, height, channels, stride)

    rgb = bytearray(width * height * 3)
    for i in range(width * height):
        s = i * channels
        d = i * 3
        if color == 2:
            rgb[d:d + 3] = flat[s:s + 3]
        elif color == 6:
            rgb[d:d + 3] = flat[s:s + 3]
        elif color == 0:
            rgb[d] = rgb[d + 1] = rgb[d + 2] = flat[s]
        elif color == 4:
            rgb[d] = rgb[d + 1] = rgb[d + 2] = flat[s]
        else:  # palette
            idx = flat[s] * 3
            rgb[d:d + 3] = palette[idx:idx + 3]
    return width, height, rgb


# ---------------------------------------------------------------- кодер PNG

def encode_png(path, width, height, rgb):
    stride = width * 3
    rows = []
    prev = bytearray(stride)
    for y in range(height):
        line = rgb[y * stride:(y + 1) * stride]
        rows.append(b"\x02" + bytes((line[i] - prev[i]) & 0xFF for i in range(stride)))
        prev = line
    raw = b"".join(rows)

    def chunk(tag, body):
        return (struct.pack(">I", len(body)) + tag + body
                + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF))

    blob = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(blob)


# ---------------------------------------------------------------- обработка

def box_resize(src, sw, sh, dw, dh):
    """Separable area-average: усредняет по площади, без ступенек."""
    if (dw, dh) == (sw, sh):
        return src

    def weights(src_n, dst_n):
        out = []
        ratio = src_n / dst_n
        for d in range(dst_n):
            lo, hi = d * ratio, (d + 1) * ratio
            first, last = int(lo), min(int(hi - 1e-9), src_n - 1)
            spans = []
            for s in range(first, last + 1):
                overlap = min(hi, s + 1) - max(lo, s)
                if overlap > 0:
                    spans.append((s, overlap))
            total = sum(w for _, w in spans)
            out.append([(s, w / total) for s, w in spans])
        return out

    # горизонталь
    hw = weights(sw, dw)
    tmp = bytearray(dw * sh * 3)
    for y in range(sh):
        row = y * sw * 3
        out_row = y * dw * 3
        for d, spans in enumerate(hw):
            r = g = b = 0.0
            for s, w in spans:
                p = row + s * 3
                r += src[p] * w
                g += src[p + 1] * w
                b += src[p + 2] * w
            q = out_row + d * 3
            tmp[q] = min(255, round(r))
            tmp[q + 1] = min(255, round(g))
            tmp[q + 2] = min(255, round(b))

    # вертикаль
    vw = weights(sh, dh)
    out = bytearray(dw * dh * 3)
    for d, spans in enumerate(vw):
        out_row = d * dw * 3
        for x in range(dw):
            r = g = b = 0.0
            for s, w in spans:
                p = s * dw * 3 + x * 3
                r += tmp[p] * w
                g += tmp[p + 1] * w
                b += tmp[p + 2] * w
            q = out_row + x * 3
            out[q] = min(255, round(r))
            out[q + 1] = min(255, round(g))
            out[q + 2] = min(255, round(b))
    return out


def border_color(rgb, w, h):
    """Цвет полей: самый частый из 4 углов; ничьи разрешает периметр 3px.

    Углы выбираются как основа потому, что именно в них стык полей с кадром
    заметнее всего; периметр нужен только чтобы развести совпадения.
    """
    ring = collections.Counter()
    for y in range(h):
        for x in range(w):
            if x < 3 or y < 3 or x >= w - 3 or y >= h - 3:
                p = (y * w + x) * 3
                ring[bytes(rgb[p:p + 3])] += 1

    corners = collections.Counter()
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        p = (y * w + x) * 3
        corners[bytes(rgb[p:p + 3])] += 1

    best = max(corners.values())
    tied = [c for c, n in corners.items() if n == best]
    color = max(tied, key=lambda c: (ring[c], c))
    return tuple(color), corners[color], 4, ring[color]


def compose(src, sw, sh, cw, ch, color):
    """Центрирует изображение на канвасе, заполняя поля цветом."""
    out = bytearray(bytes(color) * (cw * ch))
    ox, oy = (cw - sw) // 2, (ch - sh) // 2
    for y in range(sh):
        s = y * sw * 3
        d = ((y + oy) * cw + ox) * 3
        out[d:d + sw * 3] = src[s:s + sw * 3]
    return out


def main():
    dry = "--dry-run" in sys.argv
    sources = sorted(glob.glob(os.path.join(SRC_DIR, "*.png")))
    if not sources:
        print("В screen_shots/ нет PNG", file=sys.stderr)
        return 1

    cw, ch = CANVAS
    if not dry:
        os.makedirs(DST_DIR, exist_ok=True)

    for path in sources:
        name = os.path.basename(path)
        sw, sh, rgb = decode_png(path)

        scale = min(1.0, cw / sw, ch / sh)
        nw, nh = round(sw * scale), round(sh * scale)
        scaled = box_resize(rgb, sw, sh, nw, nh) if (nw, nh) != (sw, sh) else rgb

        color, corner_hits, corner_total, ring_hits = border_color(scaled, nw, nh)
        canvas = compose(scaled, nw, nh, cw, ch, color)

        pad_v = (ch - nh) / ch * 100
        pad_h = (cw - nw) / cw * 100
        print(f"{name}")
        print(f"  источник : {sw}x{sh}")
        print(f"  вписано  : {nw}x{nh} (масштаб {scale:.3f})")
        print(f"  поля     : цвет rgb{color}, "
              f"углов {corner_hits}/{corner_total}, точек периметра {ring_hits}")
        print(f"  свободно : {pad_h:.0f}% по ширине, {pad_v:.0f}% по высоте")

        if not dry:
            dst = os.path.join(DST_DIR, name)
            encode_png(dst, cw, ch, canvas)
            print(f"  записано : {os.path.relpath(dst, ROOT)} ({os.path.getsize(dst)} bytes)")
            vw, vh, vrgb = decode_png(dst)
            assert (vw, vh) == (cw, ch), f"{name}: размер {vw}x{vh} вместо {cw}x{ch}"
            assert vrgb == canvas, f"{name}: пиксели после перекодирования не совпали"
            ox, oy = (cw - nw) // 2, (ch - nh) // 2
            for x, y in ((0, 0), (cw - 1, ch - 1), (ox // 2, ch // 2), (cw - 1, oy // 2)):
                q = (y * cw + x) * 3
                got = tuple(vrgb[q:q + 3])
                assert got == color, f"{name}: поле в ({x},{y}) = rgb{got}, ожидался rgb{color}"
            inner = vrgb[((oy + nh // 2) * cw + ox + nw // 2) * 3:
                         ((oy + nh // 2) * cw + ox + nw // 2) * 3 + 3]
            print(f"  проверено: {vw}x{vh}, пиксели и поля перечитаны с диска, "
                  f"центр rgb{tuple(inner)}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
