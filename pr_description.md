## 概述

为 Chat Mode 引入流式 SSE 响应、面板拖拽记忆功能和多项交互优化。

## 变更内容

### 🆕 Chat Mode 流式问答
- 新增 `/api/chat/stream` SSE 端点，实现逐 token 流式输出
- 独立聊天区 (`#chatLogChat`)，与 Report Mode 分开显示
- 对话历史 (`chatHistory`) 维护，支持上下文连续对话
- 实时状态栏显示响应时间和 token 计数

### 🆕 拖拽面板到记忆栏作为上下文
- 最小化药丸面板可拖入 Chat Mode 记忆栏 (`#chatMemoryBar`)
- 自动提取面板标题 + 文本内容 + 完整数据行（含下载 Excel 的全部 rows）
- 记忆以 chip 形式展示，支持 ✕ 按钮单个删除
- 多个记忆自动拼接传递给 LLM 作为上下文

### 🎨 UI / UX 优化
- **药丸堆叠**：最小化面板以 35px 级联偏移排列，避免重叠
- **面板标题**：显示用户实际查询文本，而非固定 "Analysis Report"
- **动画加速**：最小化/展开动画从 600ms 缩短至 250ms
- **交互限制**：只有最小化的面板可拖入记忆栏，展开面板不可拖拽
- **默认模式**：页面默认加载 Report Mode 而非 Chat Mode

### 🛠 服务端修复
- **请求体大小限制**：`auth.py` 4096→65536 bytes，`server.py` 8192→65536 bytes（支持大上下文传递）
- **LLM 输出限制**：`max_tokens` 256→2048（完整生成 10 条推荐等长回答）
- `_read_json_body()` 增加 `max_size` 参数，兼容各端不同需求

## 文件变更

| 文件 | 行数 | 说明 |
|------|------|------|
| `public/app.js` | +334/-93 | Chat Mode 流式逻辑、面板拖拽记忆、药丸堆叠/标题/动画 |
| `server.py` | +82 | SSE 端点 `handle_chat_stream`、请求体限制放宽、max_tokens 增大 |
| `public/styles.css` | +441/-78 | 记忆栏、chip、拖放高亮、药丸布局样式 |
| `public/index.html` | +22/-6 | 新增记忆栏 DOM、Chat Mode 聊天区、默认按钮状态 |
| `auth.py` | +4 | `_read_json_body` 增加 `max_size` 参数 |
| `public/auth.js` | +2 | 版本号更新 |
| `llm_provider.py` | +88 | _(保留已有改动)_ |

## 前置依赖

- 需要 LLM API Key（DeepSeek/Claude）以启用 Chat Mode 流式响应
- 无数据迁移或 schema 变更

## 验证方式

1. 启动服务 `python server.py`
2. 默认进入 Report Mode，提问生成面板
3. 最小化面板后拖入记忆栏 → 出现 chip
4. 切换 Chat Mode 提问 → 流式 SSE 响应
5. 拖入带完整数据的 Tier2 面板 → LLM 可引用全量数据回答
