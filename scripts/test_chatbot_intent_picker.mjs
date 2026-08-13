import fs from "node:fs";

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: 未匹配 ${pattern}`);
}

function assertNotMatch(text, pattern, label) {
  if (pattern.test(text)) throw new Error(`${label}: 不应匹配 ${pattern}`);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

assertMatch(html, /id="chatIntentMenu"/, "聊天框应提供提问类型菜单");
assertMatch(html, /role="listbox"/, "提问类型菜单应支持列表语义");
assertMatch(html, /class="chat-intent-menu-title"/, "提问类型菜单应提供简洁标题");
assertMatch(html, /class="chat-intent-option-prefix"/, "提问类型选项应显示命令前缀");
assertMatch(html, /class="chat-intent-option-hint"/, "提问类型选项应提供简短说明");
for (const intent of ["merchant", "category", "tier", "categorytier", "trend", "payment", "asin", "publisher", "publisherprofile"]) {
  assertMatch(html, new RegExp(`data-chat-intent="${intent}"`), `提问类型菜单应包含 ${intent}`);
}
assertMatch(html, /Category &amp; Tier/, "菜单应提供 Category & Tier 组合选项");
assertMatch(html, /data-chat-intent="merchant"[\s\S]{0,200}>Merchant</, "菜单选项显示应首字母大写");
assertMatch(html, /data-chat-intent="category"[\s\S]{0,200}>Category</, "品类选项显示应首字母大写");
assertMatch(html, /data-chat-intent="trend"[\s\S]{0,200}>Trend</, "趋势选项显示应首字母大写");
assertMatch(app, /\{ key: "categorytier", intent: "category", prefixLabelI18n: /, "Category & Tier 应映射到 category 意图");
assertMatch(app, /categorytier\|category\\s\*&\\s\*tier\|品类\\s\*\[\+＋\]\\s\*tier\|merchant\|category\|tier\|trend\|payment\|asin/, "命令解析应支持 categorytier 前缀");
assertMatch(app, /!forcedCategoryTier\s*&&\s*!llmIndicatesRecommendation[\s\S]{0,200}keywordSearchAnswer/, "categorytier 应跳过 keyword 搜索分支");

assertMatch(app, /function showChatIntentMenu\s*\(/, "应提供打开提问类型菜单的函数");
assertMatch(app, /function hideChatIntentMenu\s*\(/, "应提供关闭提问类型菜单的函数");
assertMatch(app, /function selectChatIntent\s*\(/, "应提供选择提问类型的函数");
assertMatch(app, /function parseChatIntentPrefix\s*\(/, "应解析提问类型前缀");
assertMatch(app, /state\.deepMode/, "提问类型菜单应绑定 Report Mode 状态");
assertMatch(app, /trend[\s\S]+analysis/, "trend 应映射到现有 analysis intent");
assertMatch(styles, /\.chat-intent-menu\s*\{/, "应提供提问类型菜单样式");
assertMatch(styles, /\.chat-intent-option\s*\{/, "应提供提问类型选项样式");
assertMatch(styles, /\.chat-intent-menu\s*\{[^}]*padding:\s*6px;[^}]*border-radius:\s*14px;[^}]*box-shadow:\s*0 16px 40px rgba\(73,\s*54,\s*119,\s*0\.1\)/, "菜单应使用简洁的高端浮层结构");
assertNotMatch(styles, /\.chat-intent-menu\s*\{[^}]*backdrop-filter:/, "菜单不应使用过度的背景模糊");
assertMatch(styles, /\.chat-intent-option\s*\{[^}]*border-radius:\s*8px;[^}]*transition:[^;]*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/, "选项应使用精致圆角和自定义缓动");
assertMatch(styles, /\.chat-intent-menu\s*\{[^}]*grid-template-columns:\s*1fr;/, "菜单应使用命令面板式单列布局");
assertMatch(styles, /\.chat-intent-menu-title\s*\{/, "菜单标题应有独立层级");
assertMatch(styles, /\.chat-intent-option\s*\{[^}]*grid-template-columns:\s*22px minmax\(0, 1fr\) max-content;/, "选项应保持前缀、名称和说明对齐");
assertMatch(styles, /\.chat-intent-menu\s*\{[^}]*width:\s*min\(100%,\s*280px\);[^}]*padding:\s*6px;/, "菜单应进一步收紧尺寸");
assertMatch(styles, /\.chat-intent-option\s*\{[^}]*min-height:\s*30px;[^}]*padding:\s*5px 6px;[^}]*background:\s*transparent;/, "选项默认状态应无背景色");
assertMatch(styles, /\.chat-intent-option-prefix\s*\{[^}]*background:\s*transparent;/, "命令前缀不应显示色块");
assertMatch(styles, /\.chat-intent-option:hover,[\s\S]*?\.chat-intent-option\.active\s*\{[^}]*background:\s*transparent;/, "选项交互状态也应保持无背景色");
  assertMatch(styles, /\.chat-input \.chat-intent-option\s*\{[^}]*border:[^;]+!important;[^}]*background:\s*transparent\s*!important;/, "命令面板选项应覆盖聊天发送按钮的蓝色背景规则");
  assertMatch(styles, /\.chat-input \.chat-intent-option::after\s*\{[^}]*display:\s*none;/, "命令面板选项不应继承发送按钮渐变层");
  assertMatch(styles, /body\.dashboard-mode[\s\S]*?\.chat-input \.chat-intent-option[\s\S]*?background-image:\s*none\s*!important;/, "深色主题的高优先级蓝色背景规则也应被命令面板覆盖");
  assertMatch(styles, /body\.dashboard-mode\[data-dash-theme="light"\][\s\S]*?\.chat-input \.chat-intent-option[\s\S]*?background:\s*transparent\s*!important;/, "浅色主题的高优先级蓝色背景规则也应被命令面板覆盖");
  assertMatch(styles, /body\.dashboard-mode\[data-dash-theme="light"\][\s\S]*?\.chat-input \.chat-intent-option[\s\S]*?color:\s*#5e5474;/, "浅色主题的非选中命令选项应保持可读文字颜色");
  assertMatch(html, /styles\.css\?v=20260813-prefixlabel1/, "菜单样式更新应提升缓存版本");

assertMatch(styles, /\.chat-intent-option\.active \.chat-intent-option-label\s*\{[^}]*font-weight:\s*800;/, "选中命令选项标签应加粗");
assertMatch(styles, /body\.dashboard-mode\[data-dash-theme="light"\][\s\S]*?\.chat-intent-option\.active \.chat-intent-option-label\s*\{[^}]*color:\s*#513b91;/, "浅色主题的选中标签应使用紫色区分");

assertMatch(html, /id="chatInputCommandOverlay"/, "输入框应提供命令前缀视觉层");
assertMatch(app, /function syncChatInputCommandOverlay\s*\(/, "输入框应同步命令前缀视觉层");
assertMatch(styles, /\.chat-input-command-overlay\s*\{/, "输入框应提供命令前缀视觉层样式");
assertMatch(styles, /\.chat-input-command-overlay \.command-token\s*\{[^}]*font-weight:\s*800;/, "输入框命令前缀应加粗");
assertMatch(styles, /body\.dashboard-mode\[data-dash-theme="light"\][\s\S]*?\.chat-input input\.has-command-overlay\s*\{[^}]*color:\s*transparent\s*!important;/, "浅色主题下输入框原文字应隐藏以避免与视觉层重叠");
assertMatch(app, /command-caret/, "输入框命令视觉层应提供自定义光标");
assertMatch(styles, /\.chat-input-command-overlay \.command-caret\s*\{/, "输入框命令视觉层应提供光标样式");
assertMatch(styles, /\.chat-input input\.has-command-overlay\s*\{[^}]*caret-color:\s*transparent\s*!important;/, "输入框原生光标应隐藏以避免与自定义光标错位");

// 命令格式：xxx: <问题>（如 "trend: shokz"），替代旧的 /xxx 斜杠格式
assertMatch(app, /chatIntentPrefixText\(selected\)\s*\+\s*":\s*"/, "选择类型后应写入显示名前缀");
// 菜单显示名与 key 不一致的项（Category & Tier）应写入显示名，解析器兼容两种写法
assertMatch(app, /categorytier\|category\\s\*&\\s\*tier\|品类\\s\*\[\+＋\]\\s\*tier\|merchant/, "命令视觉层正则应支持 Category & Tier 显示名前缀");
assertMatch(app, /"category&tier":\s*"categorytier"/, "命令前缀别名应归一化 Category & Tier 到 categorytier");
assertMatch(app, /"品类\+tier":\s*"categorytier"/, "命令前缀别名应归一化 品类 + Tier 到 categorytier");
assertMatch(app, /function chatIntentPrefixText\s*\(/, "应提供菜单显示名前缀文本函数");
assertMatch(app, /prefixLabelI18n/, "CHAT_INTENT_OPTIONS 应标记使用显示名的选项");
assertMatch(app, /function parseChatIntentPrefix[\s\S]{0,400}\[:：\]/, "命令解析应支持半角与全角冒号");
assertNotMatch(app, /els\.chatInput\.value\s*=\s*"\/"\s*\+\s*selected\.key/, "不应再写入旧式 /xxx 前缀");
assertNotMatch(app, /parseChatIntentPrefix[\s\S]{0,200}\\\/\(merchant/, "命令解析不应再依赖斜杠格式");
assertMatch(app, /\/\^\\s\*\\\/\\w\*\$\/\.test\(value\)[\s\S]{0,80}showChatIntentMenu/, "仍应以 / 输入弹出提问菜单");
assertMatch(app, /\/\^\\s\*\\\/\\w\*\$\/\.test\(els\.chatInput\.value/, "键盘导航仍应支持 / 输入弹出菜单");
assertMatch(html, /<kbd>\/<\/kbd>/, "菜单标题应提示按 / 弹出菜单");

// 回归：trend: <目标> 必须把目标文本写入 analysisTarget。
// 否则下游 analysisAnswer 只在「剥离趋势词后 ≠ 原文」时才提取目标，
// 对仅含品牌名的 prompt（如 "trend: shokz" → "shokz"）永远提取不到，输出「未找到」。
assertMatch(app, /explicitChatIntent\s*&&\s*explicitChatIntent\.key\s*===\s*"trend"[\s\S]{0,800}analysisTarget/, "trend 意图应把命令目标写入 analysisTarget");
assertMatch(app, /analysisTarget:\s*trendTargetCleaned\s*\|\|\s*trendTarget/, "trend 意图应优先使用清理后的目标文本");

// 使用说明（Report Mode 帮助面板）应介绍提问类型命令
assertMatch(app, /## 一、提问类型命令/, "中文说明书应介绍提问类型命令");
assertMatch(app, /输入\s*\/\s*弹出提问类型菜单/, "中文说明书应说明 / 快捷菜单");
assertMatch(app, /categorytier: electronics in tier2/, "中文说明书应提供 Category & Tier 示例");
assertMatch(app, /9 种提问类型/, "中文说明书应列出全部 9 种提问类型");
assertMatch(app, /紫色加粗/, "中文说明书应说明前缀的紫色加粗显示");
assertMatch(app, /## 1\. Question Type Commands/, "英文说明书应介绍提问类型命令");
assertMatch(app, /The 9 Question Types/, "英文说明书应列出全部 9 种提问类型");
assertMatch(app, /categorytier: electronics in tier2/, "英文说明书应提供 Category & Tier 示例");

// 交互增强：键盘高亮滑轨、光轨层、按压物理、交错浮现
assertMatch(html, /id="chatIntentMenuTrack"/, "菜单应提供键盘高亮滑轨");
assertMatch(app, /chatIntentMenuTrack: document\.getElementById\("chatIntentMenuTrack"\)/, "JS 应挂载键盘高亮滑轨");
assertMatch(app, /updateChatIntentHighlight[\s\S]{0,600}offsetTop/, "滑轨应基于选项 offsetTop 定位");
assertMatch(styles, /\.chat-intent-menu-track\s*\{[^}]*transition:[^}]*transform 0\.3s cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/, "滑轨应使用自定义贝塞尔滑动");
assertMatch(styles, /\.chat-intent-option::before\s*\{[^}]*opacity:\s*0;/, "选项应提供默认隐藏的光轨层");
assertMatch(styles, /\.chat-intent-option:hover::before[^{]*\{[^}]*opacity:\s*1;/, "悬停时光轨层应渐现");
assertMatch(styles, /\.chat-intent-option:active\s*\{[^}]*scale\(0\.98\d*\)/, "按压时选项应有物理缩放");
assertMatch(styles, /chat-intent-option-in/, "菜单选项应有交错浮现动画");
assertMatch(styles, /animation:[^;}]*backwards/, "交错动画应在延迟期间保持隐藏");
assertMatch(styles, /\.chat-intent-option:hover \.chat-intent-option-prefix[^{]*\{[^}]*translateX\(1px\)/, "悬停时命令前缀应有微位移");
assertMatch(styles, /\.chat-intent-option-hint\s*\{[^}]*opacity:\s*0\.\d+/, "提示文字默认应弱化");
assertMatch(styles, /\.chat-intent-option:hover \.chat-intent-option-hint[^{]*\{[^}]*opacity:\s*1/, "悬停时提示文字应渐显");
assertMatch(styles, /\.chat-input-command-overlay \.command-caret\s*\{[^}]*box-shadow:/, "命令光标应带光晕");

console.log("PASS: chatbot intent picker contract tests");
