# 当前 AI 打牌逻辑（Web 实现版）

本文描述 **本仓库当前已实现** 的机器人策略，代码在 **`ai.js`**（`logic.js` re-export）：`candidates` → `pickLead` / `pickBeat` → `botMove`。目标是 **红蓝队得分最大化**（抓住对手名次），不是个人最快出完。

## 1. 总流程

```
轮到 bot
  → candidates(手牌, 将牌, 桌面牌型) 生成合法着法
  → 无桌面：pickLead 选领出
  → 有桌面：pickBeat 选压制或 null（不要）
  → 按昵称性格概率决定是否「犯错 / 吃队友」
  → play / pass
```

服务端约 1.8–2.5 秒调度一次 `botMove`（仅剩 AI 时更快）；人类超时走 `autoAct`，与 bot 策略无关。

## 2. 角色：主攻 / 辅助

发牌后 `assignRoles`：每队三人按 `handStrength` 排序——最强为 **main（主攻）**，其余为 **support（辅助）**。

## 3. 牌力：`wildSpendCost` + `shapeBreakCost`

- **惜怪** `wildSpendCost`：怪垫低对/三代价高；纯怪出手为 0。
- **拆型** `shapeBreakCost`：拆四张/三张/对子去出更小路、用大红怪垫中低五路代价高；鼓励出孤儿单。
- `pickFrom` 按 `wild + shape`（及弱五路惩罚）排序；跟牌额外偏好「刚好压过」。

## 4. 领出 / 跟牌（摘要）

- 压制短敌、按张数喂队友、慎开弱杂顺/弱同花（默认不从 A2345 一类最弱五路开局）。
- 队友对子/三张/五路默认不压；仅小单接牌喂主攻或阻敌残局。
- 非残局：怪花费或拆型超阈值则 **不要**。

## 5. 性格与智能分（概率倾向）

座位旁显示 **智能 n/5**（`intel`）。按昵称挂参数；**每手独立掷骰**（非绝对）。

| 智能 | 代表 | 倾向 |
|------|------|------|
| 5/5 | **麒麟**（我方）、**朝日**（对方） | 不犯错、不吃队友；惜牌力；带飞队友 |
| 4/5 | 老克勒 / 路子王 / 册那队长 | 大多稳 |
| 3/5 | 默认昵称 | 中庸 |
| 2/5 | 小滑头 / 小赤佬 | 更敢花怪 |
| 1/5 | 十三点 | 较高犯错率 |

每局开局：`placeEliteBots` 保证房主队有 **麒麟**、对队有 **朝日**。

## 6. 关联函数

| 函数 | 作用 |
|------|------|
| `handStrength` / `assignRoles` | 主攻辅助（精英优先主攻） |
| `candidates` | 合法着法 |
| `wildSpendCost` / `shapeBreakCost` / `pickFrom` | 代价与择优 |
| `personaFor` / `intelFor` / `PERSONAS` | 性格与智能分 |
| `effectivePersona` | 带飞队友 / 震慑对手 |
| `pickLead` / `pickBeat` / `botMove` | 决策 |
