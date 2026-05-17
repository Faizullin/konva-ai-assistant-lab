/**
 * Minimal Konva-compatible renderer for Node.js using @napi-rs/canvas.
 * Exposes the same API surface the LLM generates against:
 *   new Konva.Stage / Layer / Rect / Path / Circle / Line / Arrow / Text / Group / RegularPolygon
 */
import { createCanvas, Canvas, Path2D } from '@napi-rs/canvas';

type Props = Record<string, any>;

// ── Base ──────────────────────────────────────────────────────────────────────

abstract class Shape {
  constructor(protected p: Props) {}
  abstract draw(ctx: CanvasRenderingContext2D): void;
  // Fluent setters the LLM sometimes calls
  x(v: number)       { this.p.x = v; return this; }
  y(v: number)       { this.p.y = v; return this; }
  fill(v: string)    { this.p.fill = v; return this; }
  stroke(v: string)  { this.p.stroke = v; return this; }
}

// ── Shapes ────────────────────────────────────────────────────────────────────

class KRect extends Shape {
  draw(ctx: CanvasRenderingContext2D) {
    const { x = 0, y = 0, width = 0, height = 0, fill, stroke, strokeWidth = 1, cornerRadius = 0, opacity = 1 } = this.p;
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.beginPath();
    cornerRadius > 0
      ? (ctx as any).roundRect(x, y, width, height, cornerRadius)
      : ctx.rect(x, y, width, height);
    if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke(); }
    ctx.restore();
  }
}

class KPath extends Shape {
  draw(ctx: CanvasRenderingContext2D) {
    const { x = 0, y = 0, data = '', fill, stroke, strokeWidth = 1, opacity = 1, scaleX = 1, scaleY = 1 } = this.p;
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.translate(x, y); ctx.scale(scaleX, scaleY);
    const path = new Path2D(data);
    if (fill)   { ctx.fillStyle = fill; ctx.fill(path); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke(path); }
    ctx.restore();
  }
}

class KCircle extends Shape {
  draw(ctx: CanvasRenderingContext2D) {
    const { x = 0, y = 0, radius = 0, fill, stroke, strokeWidth = 1, opacity = 1 } = this.p;
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke(); }
    ctx.restore();
  }
}

class KLine extends Shape {
  draw(ctx: CanvasRenderingContext2D) {
    const { points = [], stroke = 'black', strokeWidth = 1, closed = false, fill, opacity = 1 } = this.p;
    if (points.length < 4) return;
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.beginPath(); ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    if (closed) ctx.closePath();
    if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke();
    ctx.restore();
  }
}

class KArrow extends Shape {
  draw(ctx: CanvasRenderingContext2D) {
    const { points = [], stroke = 'black', strokeWidth = 1, fill = 'black', pointerLength = 10, pointerWidth = 10, opacity = 1 } = this.p;
    if (points.length < 4) return;
    new KLine({ points, stroke, strokeWidth, opacity }).draw(ctx);
    const x1 = points[points.length - 4], y1 = points[points.length - 3];
    const x2 = points[points.length - 2], y2 = points[points.length - 1];
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.translate(x2, y2); ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-pointerLength,  pointerWidth / 2);
    ctx.lineTo(-pointerLength, -pointerWidth / 2);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.restore();
  }
}

class KText extends Shape {
  draw(ctx: CanvasRenderingContext2D) {
    const { x = 0, y = 0, text = '', fontSize = 12, fontFamily = 'Arial', fill = 'black', opacity = 1, fontStyle = '' } = this.p;
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.font = `${fontStyle} ${fontSize}px ${fontFamily}`.trim();
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y + fontSize);
    ctx.restore();
  }
}

class KRegularPolygon extends Shape {
  draw(ctx: CanvasRenderingContext2D) {
    const { x = 0, y = 0, sides = 6, radius = 0, fill, stroke, strokeWidth = 1, opacity = 1 } = this.p;
    ctx.save(); ctx.globalAlpha = opacity;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = (i * 2 * Math.PI / sides) - Math.PI / 2;
      i === 0 ? ctx.moveTo(x + radius * Math.cos(a), y + radius * Math.sin(a))
              : ctx.lineTo(x + radius * Math.cos(a), y + radius * Math.sin(a));
    }
    ctx.closePath();
    if (fill)   { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke(); }
    ctx.restore();
  }
}

class KGroup {
  private children: (Shape | KGroup)[] = [];
  constructor(private p: Props = {}) {}
  add(s: Shape | KGroup) { this.children.push(s); return this; }
  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(this.p.x ?? 0, this.p.y ?? 0);
    ctx.globalAlpha = this.p.opacity ?? 1;
    for (const c of this.children) c.draw(ctx);
    ctx.restore();
  }
}

class KLayer {
  private children: (Shape | KGroup)[] = [];
  add(s: Shape | KGroup) { this.children.push(s); return this; }
  draw() {}
  render(ctx: CanvasRenderingContext2D) { for (const c of this.children) c.draw(ctx); }
}

class KStage {
  private layers: KLayer[] = [];
  private canvas: Canvas;
  constructor(p: { width: number; height: number; container?: string }) {
    this.canvas = createCanvas(p.width, p.height);
  }
  add(l: KLayer) { this.layers.push(l); return this; }
  toBuffer(): Buffer {
    const ctx = this.canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    for (const l of this.layers) l.render(ctx);
    return (this.canvas as any).toBuffer('image/png');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const Konva = {
  Stage:          KStage,
  Layer:          KLayer,
  Rect:           KRect,
  Path:           KPath,
  Circle:         KCircle,
  Line:           KLine,
  Arrow:          KArrow,
  Text:           KText,
  RegularPolygon: KRegularPolygon,
  Group:          KGroup,
};

export function renderToBuffer(code: string, width: number, height: number): Buffer {
  const stage = new KStage({ width, height });
  const layer = new KLayer();
  stage.add(layer);
  new Function('Konva', 'stage', 'layer', code)(Konva, stage, layer);
  return stage.toBuffer();
}
