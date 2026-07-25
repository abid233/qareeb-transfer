import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const rooms = new Map();
const port = Number(process.env.PORT || 3000);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((request, response) => {
  const pathname = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const safePath = path.normalize(pathname).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) return response.writeHead(404).end('Not found');
  response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
});

function send(client, payload) {
  if (client.socket.destroyed) return;
  const text = Buffer.from(JSON.stringify(payload));
  const header = text.length < 126 ? Buffer.from([0x81, text.length]) : Buffer.from([0x81, 126, text.length >> 8, text.length & 255]);
  client.socket.write(Buffer.concat([header, text]));
}
function findPeer(room, client) { return room.host === client ? room.guest : room.host; }
function removeClient(client) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  if (!room) return;
  const peer = findPeer(room, client);
  if (peer) send(peer, { type: 'peer-left' });
  if (room.host === client) room.host = null;
  if (room.guest === client) room.guest = null;
  if (!room.host && !room.guest) rooms.delete(client.roomCode);
}
function handleMessage(client, message) {
  let data;
  try { data = JSON.parse(message); } catch { return; }
  if (data.type === 'create-room') {
    let code;
    do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (rooms.has(code));
    rooms.set(code, { host: client, guest: null }); client.roomCode = code;
    return send(client, { type: 'room-created', code });
  }
  if (data.type === 'join-room') {
    const code = String(data.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.host) return send(client, { type: 'error', message: 'هذه الجلسة غير موجودة أو انتهت.' });
    if (room.guest) return send(client, { type: 'error', message: 'الجلسة مرتبطة بجهازين بالفعل.' });
    room.guest = client; client.roomCode = code;
    send(client, { type: 'joined-room', code }); return send(room.host, { type: 'peer-joined' });
  }
  if (data.type === 'signal') {
    const room = rooms.get(client.roomCode);
    const peer = room && findPeer(room, client);
    if (peer) send(peer, { type: 'signal', signal: data.signal });
  }
}
function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0], second = client.buffer[1], opcode = first & 0x0f, masked = Boolean(second & 0x80);
    let length = second & 0x7f, offset = 2;
    if (length === 126) { if (client.buffer.length < 4) return; length = client.buffer.readUInt16BE(2); offset = 4; }
    if (length === 127 || !masked) { client.socket.destroy(); return; }
    if (client.buffer.length < offset + 4 + length) return;
    const mask = client.buffer.subarray(offset, offset + 4);
    const payload = client.buffer.subarray(offset + 4, offset + 4 + length);
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    client.buffer = client.buffer.subarray(offset + 4 + length);
    if (opcode === 0x8) { client.socket.end(); return; }
    if (opcode === 0x1) handleMessage(client, payload.toString('utf8'));
  }
}
server.on('upgrade', (request, socket) => {
  if (request.headers.upgrade?.toLowerCase() !== 'websocket' || !request.headers['sec-websocket-key']) return socket.destroy();
  const accept = crypto.createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client = { socket, buffer: Buffer.alloc(0), roomCode: null };
  socket.on('data', (chunk) => parseFrames(client, chunk));
  socket.on('close', () => removeClient(client));
  socket.on('error', () => removeClient(client));
});
server.listen(port, () => console.log(`قريب يعمل على http://localhost:${port}`));
