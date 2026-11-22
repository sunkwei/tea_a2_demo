# 🎮 GoDot · 三国肉鸽

三国背景的 **2.5D 俯视角肉鸽**（Godot 4.3）。第一关「黄巾之乱 · 广宗道」：三阶段推进，一路刷兵、精英、最后打张角。

- 🗡️ **武将武技卡牌**：击杀升级 → 三选一（关羽 / 张飞 / 赵云 / 黄忠 … 的招式，普通→传说四档稀有度）
- 🌊 **波次推进**：每关分阶段、每阶段若干波，带精英与 Boss（张角）；HUD 有 Boss 血条与阶段提示
- 🖼️ **像素素材**：Tiny Swords / Kenney（CC0）+ 缝合像素字体（OFL 1.1），贴图全部随仓库带上
- 🎛️ **纯 GDScript**：无插件依赖，`gl_compatibility` 渲染器，1280×720 窗口

## 运行

```bash
# 用 Godot 4.3 打开本目录（选中 project.godot），然后按 F5
godot --path GoDot                     # 直接跑
godot --headless --path GoDot --script res://tools/selftest.gd   # 无头自测
```

截图（自动化用）：

```bash
godot --path GoDot -- --shot=shots/start.png --shot-delay=2
```

> `shots/` 已进 `.gitignore`（调试残渣），需要入库的预览图请另存。

## 目录

| 路径 | 说明 |
|---|---|
| `project.godot` | 工程配置（主场景 `scenes/Main.tscn`，自动加载 `scripts/data.gd`） |
| `scenes/Main.tscn` | 唯一场景：Main 节点挂 `main.gd` |
| `scripts/main.gd` | 流程状态机：标题 → 战斗 → 升级三选一 → 结算（胜/负） |
| `scripts/arena.gd` | 战场：地形、刷怪波次、伤害结算、技能特效、镜头 |
| `scripts/player.gd` · `enemy.gd` · `projectile.gd` | 玩家 / 敌兵 / 弹道 |
| `scripts/skill_system.gd` | 主动技效果（扇形斩、突刺、箭雨、光环…）与被动 |
| `scripts/data.gd` | 数据表：武技池、敌兵、关卡阶段与波次（纯数据，方便无头自测） |
| `scripts/hud.gd` · `healthbar.gd` · `anim_sprite.gd` · `texgen.gd` | 界面、血条、像素精灵帧动画、运行时贴图生成 |
| `tools/selftest.gd` | 无头自测：数据表完整性 + 技能执行 + 战斗结算 |
| `assets/` | 地形 / 建筑 / 单位 / 特效 / UI / 字体 |

## 素材来源

| 素材 | 来源 | 许可 |
|---|---|---|
| 建筑、单位、地形、特效、UI | [Tiny Swords](https://pixelfrog-assets.itch.io/tiny-swords) / [Kenney](https://kenney.nl/) | CC0 |
| `fusion-pixel-12px-zh_hans.ttf` | 缝合像素字体 | OFL 1.1 |

---

<sub>返回[项目索引](../README.md)</sub>
