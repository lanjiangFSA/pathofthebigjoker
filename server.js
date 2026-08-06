'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  newRoom,
  addPlayer,
  start,
  play,
  pass,
  botMove,
  state,
} = require('./logic');

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const streams = new Map();
const pub = path.join(__dirname, 'public');

function push(r) {
  r.players.forEach((p) => {
    const s = streams.get(p.id);
    if (s) s.write(`data: ${JSON.stringify(state(r, p.id))}\n\n`);
  });
}

setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.started) continue;
    const p = r.players[r.turn];
    if (p?.bot) {
      setTimeout(() => {
        if (r.started && r.players[r.turn]?.id === p.id) {
          botMove(r, p);
          push(r);
        }
      }, 650);
    }
  }
}, 900);

function json(res, status, x) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(x));
}

function body(req) {
  return new Promise((ok) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        ok(JSON.parse(s || '{}'));
      } catch {
        ok({});
      }
    });
  });
}

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.md': 'text/markdown' };

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    let b, r, p;
    try {
      if (req.method === 'POST' && u.pathname === '/api/create') {
        b = await body(req);
        r = newRoom({ trumpRules: !!b.trumpRules });
        while (rooms.has(r.code)) r = newRoom({ trumpRules: !!b.trumpRules });
        p = addPlayer(r, b.name);
        rooms.set(r.code, r);
        return json(res, 200, { code: r.code, id: p.id });
      }
      if (req.method === 'POST' && u.pathname === '/api/join') {
        b = await body(req);
        r = rooms.get((b.code || '').toUpperCase());
        if (!r) throw Error('找不到该房间');
        if (r.started) throw Error('牌局已经开始，请等待下一局');
        p = addPlayer(r, b.name);
        push(r);
        return json(res, 200, { code: r.code, id: p.id });
      }
      if (req.method === 'POST' && u.pathname === '/api/start') {
        b = await body(req);
        r = rooms.get(b.code);
        p = r?.players.find((x) => x.id === b.id);
        if (!p) throw Error('连接已失效');
        if (p.id !== r.host) throw Error('只有房主可以开始');
        start(r);
        push(r);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && ['/api/play', '/api/pass'].includes(u.pathname)) {
        b = await body(req);
        r = rooms.get(b.code);
        p = r?.players.find((x) => x.id === b.id);
        if (!p) throw Error('连接已失效');
        if (u.pathname === '/api/play') play(r, p, b.cards || []);
        else pass(r, p);
        push(r);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && u.pathname === '/api/stream') {
        r = rooms.get(u.searchParams.get('code'));
        p = r?.players.find((x) => x.id === u.searchParams.get('id'));
        if (!p) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        streams.set(p.id, res);
        res.write(`data: ${JSON.stringify(state(r, p.id))}\n\n`);
        req.on('close', () => streams.delete(p.id));
        return;
      }
      const file = path.join(pub, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, ''));
      if (!file.startsWith(pub) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': (mime[path.extname(file)] || 'text/plain') + '; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      json(res, 400, { error: e.message || '请求失败' });
    }
  })
  .listen(PORT, () => console.log(`大怪路子：http://localhost:${PORT}`));
