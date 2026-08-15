# 鱼类与水面垃圾识别模型方案

## 当前网页识别链路

网页默认使用 YOLO26n ONNX，通过 ONNX Runtime Web 在浏览器本地推理。模型无法加载时，会自动切换到高精度 COCO-SSD MobileNet V2；两个模型都没有结果时，再使用运动区域分析保持三维画面连续。

默认 YOLO26n 仍使用 COCO 80 类，只用于通用目标识别。要识别鱼和水面垃圾，需要用项目数据微调专用模型。

## 推荐数据组成

建议训练集不要只依赖一个公开数据集：

1. **北理珠月牙湖实拍数据（最重要，建议占 50% 以上）**
   - 使用最终安装位置、镜头角度和分辨率采集。
   - 覆盖晴天、阴天、逆光、傍晚、浑水、水面反光和雨后。
   - 从视频按 1–3 秒间隔抽帧，删除近似重复帧。
   - 第一版建议至少 2,000 张标注图；正式部署建议 5,000–10,000 张。
2. **DeepFish / Fish4Knowledge**
   - 补充自然水下环境中的鱼类姿态、遮挡和尺度变化。
   - DeepFish: https://alzayats.github.io/DeepFish/
   - Fish4Knowledge: https://groups.inf.ed.ac.uk/vision/DATASETS/FISH4KNOWLEDGE/
3. **TrashCan**
   - 水下垃圾、机器人、动植物等目标，提供检测框和分割标签。
   - 论文: https://arxiv.org/abs/2007.08097
4. **TACO**
   - 补充塑料瓶、塑料袋、易拉罐、包装物等真实场景垃圾。
   - 数据工具: https://github.com/pedropro/TACO
5. **SUIM**
   - 补充鱼、水草、礁石、机器人和水下背景，适合后续升级实例分割。
   - 数据集: https://github.com/IRVLab/SUIM

## 类别规范

项目默认类别定义在 `docs/vision-dataset.yaml`：

- `fish`
- `plastic_bottle`
- `plastic_bag`
- `can`
- `foam`
- `fishing_net`
- `branch`
- `aquatic_plant`
- `other_trash`
- `person`（只用于水枪云台安全拦截，不作为跟踪目标）

训练集、验证集和测试集必须按视频片段划分，不能把同一段视频的相邻帧随机分到不同集合，否则验证结果会虚高。

必须保留一批“只有人员、没有垃圾”和“人员拿着/靠近垃圾”的困难样本，并完整标注人员框。否则专用模型上线后虽然垃圾识别更准，却可能失去人员邻近暂停能力。水面、反光、空画面等无目标图片也要作为负样本保留，不要伪造空标签。

## 训练与导出

在带 NVIDIA GPU 的电脑创建独立 Python 环境：

```bash
pip install ultralytics
python scripts/train-vision-model.py --device 0 --epochs 120
```

训练脚本会把最佳权重导出为：

```text
apps/frontend/public/models/fish-trash-yolo26n.onnx
```

在前端环境变量中配置：

```text
NEXT_PUBLIC_YOLO_MODEL_URL=/models/fish-trash-yolo26n.onnx
NEXT_PUBLIC_YOLO_CLASS_NAMES=fish,plastic_bottle,plastic_bag,can,foam,fishing_net,branch,aquatic_plant,other_trash,person
```

重新构建网页后，“YOLO26n · 推荐”会自动使用专用模型。

ONNX 推理所需的 WASM 文件会随网页一起打包，不依赖外部 CDN。部署时建议将专用模型放在上述 `public/models` 目录并使用站内地址，这样识别功能可以离线运行。

## 验收指标

- 每个核心类别至少 200 个验证实例。
- `mAP50-95`、Precision、Recall 分类别统计。
- 单独测试小目标、遮挡、反光、浑水和夜间画面。
- 单独测试人员靠近垃圾、人员手持垃圾以及多人遮挡；任何人员邻近目标时，水枪云台必须暂停自动跟踪。
- 实船连续运行至少 30 分钟，记录误报、漏报和平均推理耗时。
- 网页已经要求目标连续 4 帧成立，并使用目标锁定迟滞；验收时仍需确认断流、低帧率和目标短暂消失时不会继续追踪。

Ultralytics 模型和训练工具涉及 AGPL-3.0/企业许可，商业部署前需要确认许可要求。
