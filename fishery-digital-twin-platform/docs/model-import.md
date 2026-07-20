# STEP 船体模型导入说明

浏览器页面不能直接加载 `.step` / `.stp`。需要先把 STEP 转成 Web 端常用的 `.glb`。

## 推荐流程

1. 用 CAD Assistant、FreeCAD、Fusion 360 或 SolidWorks 打开 STEP 文件。
2. 导出为 `.glb` 或先导出 `.obj/.fbx`，再用 Blender 转成 `.glb`。
3. 在 Blender 中检查模型方向，建议船头朝向 X 轴正方向。
4. 删除隐藏零件、过密细节、螺丝等展示不明显的小结构。
5. 导出 GLB 时尽量控制文件大小，建议比赛展示版保持在 `5-15 MB`。
6. 将最终文件命名为：

```text
inspection-boat.glb
```

7. 放到：

```text
apps/frontend/public/models/inspection-boat.glb
```

8. 重新启动或刷新网页。

## 页面加载逻辑

平台会自动检查：

```text
/models/inspection-boat.glb
```

如果存在，就加载真实船体模型；如果不存在，就使用内置轻量船体模型。

## 性能建议

- GLB 文件过大时，页面会卡顿。
- 尽量合并材质，减少独立网格数量。
- 不要把完整机械装配中不可见的内部零件全部导入。
- 比赛展示以外观表达为主，模型可适当简化。

