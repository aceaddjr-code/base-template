# 任务跟踪器：本地 Markdown

本仓库的规格和任务以本地 Markdown 文件跟踪。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`。
- 规格：`.scratch/<feature-slug>/spec.md`。
- 实施任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`；从 01 起按依赖顺序编号，每票一个文件。
- 每票在开头记录 `Status:` 和 `Blocked by:`；分流标签映射见 `triage-labels.md`。
- 没有前置任务时写 `Blocked by: None`；存在前置时写编号和标题。
- 后续评论追加在文件末尾的 `## Comments` 下，保留原有上下文。

## 技能动作

- “发布规格”：写入该功能的 spec.md；“发布任务”：逐票写入 issues 目录。
- “读取任务”：读取用户指明的本地路径；只有编号时，在当前功能目录定位，存在歧义时先核对。
- “领取任务”：选择所有 blockers 已完成的 ready-for-agent 任务，写入 claimed 状态后开始。
- “完成任务”：验证验收条件并记录证据，再设为 resolved。claimed/resolved 为执行状态，五种分流角色仍按标签映射使用。
- 待确认的内容保留在 drafts 目录，状态为 draft；按所用技能完成确认后，才发布为 ready-for-agent。

## 保存与交接

`.scratch` 当前被 Git 忽略，这些任务默认保存在本机。需要其他机器接续时，显式交付整个功能目录；需要版本化时再由用户决定调整保存位置或忽略规则。
