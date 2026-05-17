from difflib import SequenceMatcher
from config import MOCK_IMAGE_DB
from tracing import traced


def _similarity(a: str, b: str) -> float:
    a, b = a.lower(), b.lower()
    if a in b or b in a:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


@traced(name="resolve_images", tags=["retrieval"])
def resolve_images(concepts: list[str], language: str, num_distractors: int) -> dict:
    """Fuzzy-match concepts against MOCK_IMAGE_DB. Replace with pgvector in production."""
    print("\n[2/4] Resolving images...")
    resolved, used_ids = {}, set()

    for concept in concepts:
        best_score, best_image = 0.0, None
        for img in MOCK_IMAGE_DB:
            if img["id"] in used_ids:
                continue
            score = max(
                _similarity(concept, img["label"]),
                *[_similarity(concept, t) for t in img["tags"]],
            )
            if score > best_score:
                best_score, best_image = score, img

        if best_image and best_score > 0.3:
            resolved[concept] = {**best_image, "role": "correct", "score": round(best_score, 2)}
            used_ids.add(best_image["id"])
            print(f"    '{concept}' → {best_image['label']} ({best_score:.2f})")
        else:
            print(f"    '{concept}' → NOT FOUND")

    categories = {v["category"] for v in resolved.values()}
    for img in MOCK_IMAGE_DB:
        if len([v for v in resolved.values() if v["role"] == "distractor"]) >= num_distractors:
            break
        if img["id"] not in used_ids and img["category"] in categories:
            resolved[f"distractor_{img['id']}"] = {**img, "role": "distractor", "score": 0.0}
            print(f"    distractor  → {img['label']}")

    return resolved
