"""Train and export the project-specific YOLO26 fish/trash detector.

Install the training dependency in a dedicated Python environment:
    pip install ultralytics

Example:
    python scripts/train-vision-model.py --device 0 --epochs 120
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the fish and floating-trash detector.")
    parser.add_argument(
        "--data",
        type=Path,
        default=PROJECT_ROOT / "docs" / "vision-dataset.yaml",
        help="YOLO dataset YAML path.",
    )
    parser.add_argument("--model", default="yolo26n.pt", help="Ultralytics base checkpoint.")
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default="0", help="CUDA device such as 0, or cpu.")
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "apps" / "frontend" / "public" / "models" / "fish-trash-yolo26n.onnx",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    model = YOLO(args.model)
    model.train(
        data=str(args.data.resolve()),
        epochs=args.epochs,
        imgsz=args.image_size,
        batch=args.batch,
        device=args.device,
        project=str(PROJECT_ROOT / "runs" / "vision"),
        name="fish-trash-yolo26n",
        patience=25,
        cache=True,
        workers=4,
        degrees=8,
        translate=0.12,
        scale=0.45,
        fliplr=0.5,
        hsv_h=0.025,
        hsv_s=0.55,
        hsv_v=0.45,
    )

    best_checkpoint = Path(model.trainer.best)
    exported_path = Path(
        YOLO(str(best_checkpoint)).export(
            format="onnx",
            imgsz=args.image_size,
            simplify=True,
            nms=True,
            opset=17,
            dynamic=False,
            half=False,
        )
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exported_path, args.output)
    print(f"Exported browser model: {args.output.resolve()}")


if __name__ == "__main__":
    main()
