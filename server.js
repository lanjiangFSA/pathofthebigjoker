'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  newRoom,
  addPlayer,
  findPlayer,
  leavePlayer,
  kickPlayer,
  start,
  play,
  pass,
  botMove,
  state,
  checkTimeout,
} = require('./logic');

const os = require('os');
const PORT = process.env.PORT || 3000;

function lanUrls(port) {
  const urls = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}
const rooms = new Map();
const streams = new Map();
const pub = path.join(__dirname, 'public');
const botBusy = new Set();

function push(r) {
  r.players.forEach((p) => {
    const s = streams.get(p.id);
    if (s) {
      try {
        s.write(`data: ${JSON.stringify(state(r, p.id))}\n\n`);
      } catch {
        streams.delete(p.id);
      }
    }
  });
}

function scheduleBot(r) {
  if (!r.started || botBusy.has(r.code)) return;
  const p = r.players[r.turn];
  if (!p?.bot) return;
  botBusy.add(r.code);
  const delay = 1800 + Math.floor(Math.random() * 700);
  setTimeout(() => {
    try {
      if (r.started && r.players[r.turn]?.id === p.id) {
        botMove(r, p);
        push(r);
      }
    } catch (e) {
      console.error('botMove', r.code, e.message);
    } finally {
      botBusy.delete(r.code);
    }
  }, delay);
}

setInterval(() => {
  for (const r of rooms.values()) {
    if (checkTimeout(r)) push(r);
    else scheduleBot(r);
  }
}, 200);

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

function requireRoomPlayer(b) {
  const r = rooms.get((b.code || '').toUpperCase());
  if (!r) throw Error('找不到该房间');
  const p = findPlayer(r, b.id);
  if (!p) throw Error('连接已失效');
  return { r, p };
}

const mime = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
};

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`);
    let b, r, p;
    try {
      if (req.method === 'POST' && u.pathname === '/api/create') {
        b = await body(req);
        r = newRoom();
        while (rooms.has(r.code)) r = newRoom();
        p = addPlayer(r, b.name);
        rooms.set(r.code, r);
        return json(res, 200, { code: r.code, id: p.id, name: p.name });
      }
      if (req.method === 'POST' && u.pathname === '/api/join') {
        b = await body(req);
        r = rooms.get((b.code || '').toUpperCase());
        if (!r) throw Error('找不到该房间');
        // Idempotent: same id already seated
        if (b.id) {
          const existing = findPlayer(r, b.id);
          if (existing) {
            if (b.name) existing.name = String(b.name).trim().slice(0, 12) || existing.name;
            push(r);
            return json(res, 200, { code: r.code, id: existing.id, name: existing.name });
          }
        }
        if (r.started) throw Error('牌局已经开始，请等待下一局或使用原身份重连');
        const joinName = String(b.name || '牌友').trim().slice(0, 12) || '牌友';
        if (r.players.some((x) => !x.bot && x.name === joinName)) {
          throw Error('该昵称已在房间内；若是你本人请刷新自动重连，或换个昵称');
        }
        p = addPlayer(r, joinName);
        push(r);
        return json(res, 200, { code: r.code, id: p.id, name: p.name });
      }
      if (req.method === 'POST' && u.pathname === '/api/rejoin') {
        b = await body(req);
        r = rooms.get((b.code || '').toUpperCase());
        if (!r) throw Error('房间已解散或不存在');
        p = findPlayer(r, b.id);
        if (!p || p.bot) throw Error('座位已失效，请重新加入');
        if (b.name) p.name = String(b.name).trim().slice(0, 12) || p.name;
        return json(res, 200, { code: r.code, id: p.id, name: p.name });
      }
      if (req.method === 'POST' && u.pathname === '/api/leave') {
        b = await body(req);
        ({ r, p } = requireRoomPlayer(b));
        const mode = b.mode === 'ai' ? 'ai' : 'abort';
        const result = leavePlayer(r, p.id, mode);
        streams.delete(p.id);
        if (result.empty) {
          rooms.delete(r.code);
          return json(res, 200, { ok: true, empty: true });
        }
        push(r);
        if (result.ai) scheduleBot(r);
        return json(res, 200, { ok: true, empty: false });
      }
      if (req.method === 'POST' && u.pathname === '/api/kick') {
        b = await body(req);
        ({ r, p } = requireRoomPlayer(b));
        const kicked = kickPlayer(r, p.id, b.targetId);
        streams.delete(kicked.id);
        push(r);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && u.pathname === '/api/start') {
        b = await body(req);
        ({ r, p } = requireRoomPlayer(b));
        if (p.id !== r.host) throw Error('只有房主可以开始');
        start(r);
        push(r);
        scheduleBot(r);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && ['/api/play', '/api/pass'].includes(u.pathname)) {
        b = await body(req);
        ({ r, p } = requireRoomPlayer(b));
        if (u.pathname === '/api/play') play(r, p, b.cards || []);
        else pass(r, p);
        push(r);
        scheduleBot(r);
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
        // Replace prior stream for same id (refresh)
        const prev = streams.get(p.id);
        if (prev && prev !== res) {
          try {
            prev.end();
          } catch {
            /* ignore */
          }
        }
        streams.set(p.id, res);
        res.write(`data: ${JSON.stringify(state(r, p.id))}\n\n`);
        req.on('close', () => {
          if (streams.get(p.id) === res) streams.delete(p.id);
        });
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
  .listen(PORT, '0.0.0.0', () => {
    console.log(`大怪路子：http://localhost:${PORT}`);
    const lan = lanUrls(PORT);
    if (lan.length) console.log(`局域网：${lan.join('  ')}`);
    else console.log('局域网：未检测到 IPv4，请确认网卡已联网');
  });
