const express = require('express');
const cors = require('cors');
const path = require('path');

const PORT = 3684;
const BACKEND_WS = 'ws://localhost:9684';

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

app.get('/api/config', (req, res) => {
  res.json({
    backendWs: process.env.BACKEND_WS || BACKEND_WS,
    canvasWidth: 800,
    canvasHeight: 450,
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/shared/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════════
  跑酷游戏前端服务启动成功
  HTTP 端口: ${PORT}
  访问地址: http://localhost:${PORT}
  后端WS: ${BACKEND_WS}
  渲染引擎: HTML5 Canvas 2D
  触控支持: 全屏触摸手势
═══════════════════════════════════════════
  `);
});
