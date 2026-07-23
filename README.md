# 像素动画编辑器 (Pixel Animator)

网页版像素画 + 帧动画创作工具。支持画布绘制、图层、时间轴、洋葱皮、逐帧编辑、GIF 导出，作品可存入作品库画廊。

## 技术栈

- 前端：HTML + 原生 JavaScript + Canvas
- 后端：Node.js + Express
- 数据库：SQLite (better-sqlite3)
- GIF 导出：gif.js (CDN)

## 快速开始

```bash
cd pixel-animator
npm install
npm start
```

浏览器打开 http://localhost:3000 即可使用编辑器，画廊在 http://localhost:3000/gallery.html

## 目录结构

```
pixel-animator/
├── server/
│   ├── index.js        Express 服务器 + API 路由
│   └── db.js           SQLite 连接与建表
├── public/             前端静态资源
│   ├── index.html      编辑器主页面
│   ├── gallery.html    作品画廊页
│   ├── css/style.css   样式
│   └── js/
│       ├── canvas-engine.js  画布绘制引擎（工具/撤销重做）
│       ├── animation.js      帧动画系统（洋葱皮/播放）
│       ├── app.js            主控制器（串联各模块）
│       └── gallery.js        画廊页逻辑
├── data/               SQLite 数据文件（运行时自动创建）
└── package.json
```

## 七人分工建议

| 角色 | 人数 | 负责模块 |
|------|------|---------|
| 画布引擎组 | 2 | 绘制工具、图层系统、撤销重做、选区 |
| 动画系统组 | 2 | 时间轴、帧管理、洋葱皮、播放器 |
| 后端数据组 | 1 | 作品库 CRUD、用户系统、接口设计 |
| UI/导出组 | 1 | 调色板、GIF 导出、画廊页、视觉打磨 |
| PM/测试 | 1 | 文档、测试用例、演示素材、答辩 |

## 可扩展方向

- 图层系统（多图层叠加、可见性、排序）
- 选区/复制粘贴/翻转旋转
- 自定义画布尺寸与调色板
- 作品分享与点赞
- 时间轴拖拽重排帧
- 导出 sprite sheet（精灵图）
