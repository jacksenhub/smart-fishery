Place the converted GLB vessel model here.

Recommended path:

```text
apps/frontend/public/models/inspection-boat.glb
```

STEP files should be converted to GLB before browser rendering.

The app checks this exact file automatically. If it exists, it is loaded in
the 3D twin scene. If it does not exist, the procedural fallback boat is shown.

## Water-gun vision model

Place the trained browser detector here:

```text
apps/frontend/public/models/fish-trash-yolo26n.onnx
```

Configure the frontend build with:

```text
NEXT_PUBLIC_YOLO_MODEL_URL=/models/fish-trash-yolo26n.onnx
NEXT_PUBLIC_YOLO_CLASS_NAMES=fish,plastic_bottle,plastic_bag,can,foam,fishing_net,branch,aquatic_plant,other_trash,person
```

Keep the class order identical to `docs/vision-dataset.yaml`. The `person`
class is required by the water-gun target safety interlock.
