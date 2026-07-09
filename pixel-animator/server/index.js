// server/index.js - Express 服务器
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { stmts } = require('./db');

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- 用户认证 ----

/** 简单哈希（非生产级，仅课程演示用） */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'pixelforge_salt').digest('hex');
}

// 注册
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password || username.length < 2 || password.length < 4) {
      return res.json({ ok: false, error: '用户名至少2字符，密码至少4字符' });
    }
    const existing = stmts.findUserByName.get(username);
    if (existing) return res.json({ ok: false, error: '用户名已存在' });
    stmts.insertUser.run({ username, password: hashPassword(password), email: email || null });
    res.json({ ok: true, user: { username, email: email || '' } });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 登录
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = stmts.findUserByName.get(username);
    if (!user || user.password !== hashPassword(password)) {
      return res.json({ ok: false, error: '用户名或密码错误' });
    }
    res.json({ ok: true, user: { username: user.username, email: user.email || '' } });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// 创建作品
app.post('/api/works', (req, res) => {
  try {
    const { title, author, width, height, frameCount, fps, frames, thumbnail } = req.body;
    const info = stmts.insertWork.run({
      title: title || '未命名作品',
      author: author || '匿名',
      width,
      height,
      frameCount,
      fps,
      framesJson: JSON.stringify(frames),
      thumbnail: thumbnail || null,
    });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 获取作品列表（画廊）
app.get('/api/works', (req, res) => {
  try {
    const works = stmts.getAllWorks.all();
    res.json({ ok: true, works });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 获取单个作品详情
app.get('/api/works/:id', (req, res) => {
  try {
    const work = stmts.getWorkById.get(req.params.id);
    if (!work) return res.status(404).json({ ok: false, error: '作品不存在' });
    work.frames = JSON.parse(work.frames_json);
    delete work.frames_json;
    res.json({ ok: true, work });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 删除作品
app.delete('/api/works/:id', (req, res) => {
  try {
    stmts.deleteWork.run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 点赞
app.post('/api/works/:id/like', (req, res) => {
  try {
    stmts.addLike.run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`像素动画编辑器已启动: http://localhost:${PORT}`);
});
