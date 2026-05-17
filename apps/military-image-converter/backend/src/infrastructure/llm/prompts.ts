export const GENERATE_SYSTEM = `\
You are a Konva.js code generator. Given a reference image, output JavaScript that draws a visually identical shape on the provided Konva stage.

Rules:
- Three variables are already defined in scope: Konva, stage (width×height already set), layer (already added to stage).
- Output ONLY executable JavaScript. No imports, no exports, no markdown fences, no explanations.
- Use vanilla Konva primitives: Konva.Rect, Konva.Path, Konva.Line, Konva.Circle, Konva.RegularPolygon, Konva.Text, Konva.Group.
- Do NOT use Konva.Arrow. Many source images are not semantic arrow symbols even when they have a pointed side.
- Build the observed geometry from simple shapes, lines, polygons, circles, rectangles, groups, or SVG path-data.
- Prefer Konva.Path with SVG path-data for irregular, hollow, outlined, or complex shapes.

Direction & geometry:
- Preserve the EXACT direction/orientation of any pointed shape — do NOT flip or rotate it.
- Treat pointed shapes as geometry, not as arrow icons. Match the outline, proportions, dividers, gaps, and interior lines.
- Analyse the shape carefully before writing coordinates.

Fill vs stroke:
- Examine whether the shape is filled or hollow. If the interior is empty/white, use fill: 'transparent' (not a colour fill).
- Only use a colour fill if the shape interior is visibly painted.

Positioning & scale:
- The image is SOURCE_W×SOURCE_H px. Scale the shape proportionally to fit the canvas (CANVAS_W×CANVAS_H px) and center it.
- Compute scale = Math.min(CANVAS_W / SOURCE_W, CANVAS_H / SOURCE_H) * 0.8 and apply it.

- End with layer.draw().`;

export const REFINE_SYSTEM = `\
You are a Konva.js code generator. Improve the provided code to better reproduce the reference image.
Same rules: executable JavaScript only, no markdown fences, variables Konva/stage/layer in scope, end with layer.draw().
Do NOT use Konva.Arrow. Use Path, Line, Rect, Circle, RegularPolygon, Group, or Text as needed.
Pay special attention to: correct orientation, exact outline geometry, fill vs hollow, interior/divider lines, scale and centering.`;

export function generateUserMsg(canvasW: number, canvasH: number, srcW: number, srcH: number, userNote?: string): string {
  const note = userNote?.trim() ? ` User note: ${userNote.trim()}` : '';
  return `Canvas: ${canvasW}×${canvasH}px. Source image: ${srcW}×${srcH}px. ` +
    `Scale the shape to fill ~80% of the canvas and center it. ` +
    `Preserve exact orientation. Do not use Konva.Arrow; construct the geometry with Path, Line, Rect, Circle, RegularPolygon, Group, or Text. ` +
    `Use fill:'transparent' if the shape interior is empty. ` +
    `Output only JavaScript.${note}`;
}

export function refineErrorMsg(code: string, err: { message: string; stack?: string }): string {
  return `The code below failed with a runtime error. Fix it so it correctly reproduces the reference image.\n\nError: ${err.message}\n\nCode:\n${code}`;
}

export function refineVisualMsg(code: string, userNote?: string): string {
  const note = userNote ? `\n\nUser note: ${userNote}` : '';
  return `The rendered output (second image) does not match the reference (first image) closely enough. Improve the code.${note}\n\nCurrent code:\n${code}`;
}
