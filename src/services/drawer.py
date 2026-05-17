"""
Canvas drawer — renders a GeneratedCanvas dict to a PNG.

Visual conventions:
  Card      → gray rounded rectangle + label (image_url replaced by gray placeholder)
  DropZone  → dashed blue border + placeholder text
  Text      → plain text label
  Arrow     → solid or dashed line with arrowhead
  Tray      → row of small gray boxes at the bottom
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

from config import CANVAS_W, CANVAS_H

# ── Palette ───────────────────────────────────────────────────────────────────
BG          = (245, 246, 248)
CARD_FILL   = (210, 210, 210)
CARD_BORDER = (140, 140, 140)
DZ_FILL     = (235, 244, 255)
DZ_BORDER   = (90,  140, 220)
TEXT_COL    = (50,  50,  50)
LABEL_COL   = (70,  70,  70)
ARROW_COL   = (100, 100, 100)
TRAY_BG     = (225, 225, 225)
TRAY_ITEM   = (195, 195, 195)
TRAY_H      = 110


def _font(size: int) -> ImageFont.ImageFont:
    for name in ("arial.ttf", "Arial.ttf", "DejaVuSans.ttf", "FreeSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_w: int) -> list[str]:
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if draw.textlength(test, font=font) <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def _center_text(draw, cx, cy, text, font, color=TEXT_COL, max_w=110):
    lines = _wrap(draw, text, font, max_w)
    lh = font.size + 3
    total = lh * len(lines)
    y0 = cy - total / 2
    for line in lines:
        w = draw.textlength(line, font=font)
        draw.text((cx - w / 2, y0), line, font=font, fill=color)
        y0 += lh


def _dashed_rect(draw, x0, y0, x1, y1, color, dash=8, gap=5, width=2):
    for side in [(x0, y0, x1, y0), (x1, y0, x1, y1),
                 (x1, y1, x0, y1), (x0, y1, x0, y0)]:
        ax, ay, bx, by = side
        length = math.hypot(bx - ax, by - ay)
        dx, dy = (bx - ax) / length, (by - ay) / length
        t = 0
        drawing = True
        while t < length:
            seg = min(dash if drawing else gap, length - t)
            if drawing:
                sx, sy = ax + dx * t, ay + dy * t
                ex, ey = ax + dx * (t + seg), ay + dy * (t + seg)
                draw.line([(sx, sy), (ex, ey)], fill=color, width=width)
            t += seg
            drawing = not drawing


def _arrowhead(draw, p1, p2, color, size=10):
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    length = math.hypot(dx, dy)
    if length == 0:
        return
    ux, uy = dx / length, dy / length
    px, py = -uy, ux
    tip = p2
    b1 = (tip[0] - ux * size + px * size * 0.4,
          tip[1] - uy * size + py * size * 0.4)
    b2 = (tip[0] - ux * size - px * size * 0.4,
          tip[1] - uy * size - py * size * 0.4)
    draw.polygon([tip, b1, b2], fill=color)


def _draw_arrow(draw, p1, p2, style="solid"):
    dash = style == "dashed"
    if dash:
        dx, dy = p2[0] - p1[0], p2[1] - p1[1]
        length = math.hypot(dx, dy)
        if length == 0:
            return
        ux, uy = dx / length, dy / length
        t, drawing = 0, True
        while t < length - 12:
            seg = min(10 if drawing else 6, length - 12 - t)
            if drawing:
                sx, sy = p1[0] + ux * t, p1[1] + uy * t
                ex, ey = p1[0] + ux * (t + seg), p1[1] + uy * (t + seg)
                draw.line([(sx, sy), (ex, ey)], fill=ARROW_COL, width=2)
            t += seg
            drawing = not drawing
    else:
        draw.line([p1, p2], fill=ARROW_COL, width=2)
    _arrowhead(draw, p1, p2, ARROW_COL)


def _draw_card(draw, x, y, w, h, label, font_body, font_small):
    r = 10
    draw.rounded_rectangle([x, y, x + w, y + h], radius=r,
                            fill=CARD_FILL, outline=CARD_BORDER, width=2)
    # image placeholder (darker gray inner box)
    pad = 10
    draw.rectangle([x + pad, y + pad, x + w - pad, y + h - pad - 18],
                   fill=(185, 185, 185))
    _center_text(draw, x + w / 2, y + h - 10, label, font_small,
                 color=LABEL_COL, max_w=w - 8)


def _draw_dropzone(draw, x, y, w, h, label, font_small):
    draw.rectangle([x, y, x + w, y + h], fill=DZ_FILL)
    _dashed_rect(draw, x, y, x + w, y + h, DZ_BORDER, dash=8, gap=5, width=2)
    _center_text(draw, x + w / 2, y + h / 2, label, font_small,
                 color=DZ_BORDER, max_w=w - 8)


def _draw_tray(draw, tray: list, font_small):
    if not tray:
        return
    item_w, item_h = 100, 80
    padding = 12
    total_w = len(tray) * (item_w + padding) - padding
    start_x = (CANVAS_W - total_w) / 2
    y = CANVAS_H - TRAY_H + (TRAY_H - item_h) / 2

    draw.rectangle([0, CANVAS_H - TRAY_H, CANVAS_W, CANVAS_H], fill=TRAY_BG)
    draw.line([(0, CANVAS_H - TRAY_H), (CANVAS_W, CANVAS_H - TRAY_H)],
              fill=CARD_BORDER, width=1)

    font_xs = _font(10)
    for i, t in enumerate(tray):
        x = start_x + i * (item_w + padding)
        draw.rounded_rectangle([x, y, x + item_w, y + item_h], radius=6,
                                fill=TRAY_ITEM, outline=CARD_BORDER, width=1)
        # placeholder image area
        draw.rectangle([x + 6, y + 6, x + item_w - 6, y + item_h - 20],
                       fill=(170, 170, 170))
        label = t.get("label", t.get("image_id", ""))
        _center_text(draw, x + item_w / 2, y + item_h - 8, label,
                     font_xs, color=LABEL_COL, max_w=item_w - 4)


def draw_canvas(canvas: dict, output_path: str) -> str:
    """Render canvas dict → PNG. Returns the saved path."""
    img  = Image.new("RGB", (CANVAS_W, CANVAS_H - TRAY_H + 10), BG)
    full = Image.new("RGB", (CANVAS_W, CANVAS_H), BG)

    draw  = ImageDraw.Draw(full)
    font_body  = _font(13)
    font_small = _font(11)
    font_title = _font(15)

    nodes = canvas.get("nodes", [])
    tray  = canvas.get("tray",  [])

    # Position lookup for arrows
    centers: dict[str, tuple[float, float]] = {}
    for n in nodes:
        if n.get("x") is not None:
            w = n.get("width")  or 120
            h = n.get("height") or 120
            centers[n["id"]] = (n["x"] + w / 2, n["y"] + h / 2)

    # ── 1. Arrows (behind nodes) ──────────────────────────────────────────────
    for n in nodes:
        if n["type"] != "Arrow":
            continue
        fr = n.get("from", "")
        to = n.get("to",   "")
        if fr in centers and to in centers:
            _draw_arrow(draw, centers[fr], centers[to], n.get("style", "solid"))

    # ── 2. Nodes ──────────────────────────────────────────────────────────────
    for n in nodes:
        x = n.get("x")
        y = n.get("y")
        if x is None or y is None:
            continue
        t = n["type"]
        w = n.get("width")  or 120
        h = n.get("height") or 120
        label = (n.get("label") or n.get("placeholder") or
                 n.get("content") or n.get("image_id") or "")

        if t == "Card":
            _draw_card(draw, x, y, w, h, label, font_body, font_small)
        elif t == "DropZone":
            _draw_dropzone(draw, x, y, w, h, label or "Drop here", font_small)
        elif t == "Text":
            fs = int(n.get("fontSize") or 14)
            f  = _font(fs)
            draw.text((x, y), label, font=f, fill=TEXT_COL)

    # ── 3. Tray ───────────────────────────────────────────────────────────────
    _draw_tray(draw, tray, font_small)

    # ── 4. Task summary banner ────────────────────────────────────────────────
    summary = canvas.get("task_summary", "")[:100]
    draw.rectangle([0, 0, CANVAS_W, 28], fill=(60, 90, 140))
    sw = draw.textlength(summary, font=font_small)
    draw.text(((CANVAS_W - sw) / 2, 7), summary, font=font_small, fill=(255, 255, 255))

    full.save(output_path, "PNG")
    return output_path
