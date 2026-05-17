import Konva from 'konva';

export const CANVAS_W = 500;
export const CANVAS_H = 600;

export type ExecResult =
  | { ok: true;  dataUrl: string }
  | { ok: false; error: string };

export function execKonva(container: HTMLDivElement, code: string): ExecResult {
  container.innerHTML = '';
  const stage = new Konva.Stage({ container, width: CANVAS_W, height: CANVAS_H });
  const layer = new Konva.Layer();
  stage.add(layer);
  try {
    new Function('Konva', 'stage', 'layer', code)(Konva, stage, layer);
    layer.draw();
    return { ok: true, dataUrl: stage.toDataURL() };
  } catch (e: any) {
    stage.destroy();
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
