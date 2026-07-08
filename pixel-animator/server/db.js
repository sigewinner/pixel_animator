// server/db.js - SQLite 连接与建表
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// 确保数据目录存在
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'pixel-animator.db'));

// 建表：作品表
db.exec(`
  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT DEFAULT '匿名',
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    frame_count INTEGER NOT NULL,
    fps INTEGER DEFAULT 12,
    frames_json TEXT NOT NULL,
    thumbnail TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// 建表：用户表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// 建表：点赞表（扩展用）
db.exec(`
  CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (work_id) REFERENCES works(id)
  );
`);

// 预编译语句
const stmts = {
  insertWork: db.prepare(`
    INSERT INTO works (title, author, width, height, frame_count, fps, frames_json, thumbnail)
    VALUES (@title, @author, @width, @height, @frameCount, @fps, @framesJson, @thumbnail)
  `),
  getAllWorks: db.prepare(`
    SELECT id, title, author, width, height, frame_count, fps, thumbnail, created_at,
           (SELECT COUNT(*) FROM likes l WHERE l.work_id = works.id) AS like_count
    FROM works ORDER BY created_at DESC
  `),
  getWorkById: db.prepare(`
    SELECT * FROM works WHERE id = ?
  `),
  deleteWork: db.prepare(`DELETE FROM works WHERE id = ?`),
  addLike: db.prepare(`INSERT INTO likes (work_id) VALUES (?)`),
  // 用户认证
  findUserByName: db.prepare(`SELECT * FROM users WHERE username = ?`),
  insertUser: db.prepare(`
    INSERT INTO users (username, password, email) VALUES (@username, @password, @email)
  `),
};

module.exports = { db, stmts };
