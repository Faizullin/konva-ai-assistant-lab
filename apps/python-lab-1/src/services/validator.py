from config import CANVAS_W, CANVAS_H
from src.models.schemas import GeneratedCanvas
from tracing import traced


@traced(name="validate_and_repair", tags=["validation"])
def validate_and_repair(canvas: GeneratedCanvas, resolved_images: dict) -> tuple[GeneratedCanvas, list[str]]:
    print("\n[4/4] Validating...")
    warnings  = list(canvas.warnings)
    valid_ids = {v["id"] for v in resolved_images.values()}
    node_ids  = {n.id for n in canvas.nodes}
    tray_ids  = {t.image_id for t in canvas.tray}
    good_nodes = []

    for node in canvas.nodes:
        if node.type == "Card" and node.image_id not in valid_ids:
            warnings.append(f"Removed Card '{node.id}': unknown image_id '{node.image_id}'")
            continue

        if node.x is not None and node.width is not None:
            node.x = max(40, min(node.x, CANVAS_W - node.width  - 40))
        if node.y is not None and node.height is not None:
            node.y = max(40, min(node.y, CANVAS_H - node.height - 40))

        if node.type == "Arrow":
            fr = node.model_dump(by_alias=True).get("from")
            to = node.model_dump(by_alias=True).get("to")
            if fr not in node_ids or to not in node_ids:
                warnings.append(f"Removed Arrow '{node.id}': broken ref {fr}→{to}")
                continue

        if node.type == "DropZone":
            if not any(cid in tray_ids for cid in (node.correct_ids or [])):
                warnings.append(f"DropZone '{node.id}' has no matching tray item — unsolvable")

        good_nodes.append(node)

    canvas.nodes    = good_nodes
    canvas.warnings = warnings

    issues = len(warnings)
    print(f"    {'OK' if issues == 0 else f'{issues} issue(s) found and repaired'}")
    for w in warnings:
        print(f"    ! {w}")

    return canvas, warnings
