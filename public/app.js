const $ = (id) => document.getElementById(id);
const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
let socket; let peer; let channel; let roomCode; let received = []; let receivedInfo; let isReceiver = false;
function show(view) { ['startView', 'pairView', 'transferView'].forEach((id) => $(id).classList.toggle('hidden', id !== view)); }
function setStatus(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
function connect() { return new Promise((resolve, reject) => { socket = new WebSocket(wsUrl); socket.onopen = resolve; socket.onerror = () => reject(new Error('تعذر الاتصال بخادم الربط.')); socket.onmessage = async ({ data }) => { const message = JSON.parse(data); await handleSignalMessage(message); }; }); }
function signal(signal) { socket.send(JSON.stringify({ type: 'signal', signal })); }
async function makePeer(initiator) {
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.onicecandidate = ({ candidate }) => { if (candidate) signal({ candidate }); };
  peer.onconnectionstatechange = () => { if (peer.connectionState === 'connected') onConnected(); if (['failed', 'disconnected'].includes(peer.connectionState)) setStatus('انقطع الاتصال. أنشئ جلسة جديدة وحاول مرة أخرى.', true); };
  peer.ondatachannel = ({ channel: incoming }) => setupChannel(incoming);
  if (initiator) { setupChannel(peer.createDataChannel('qareeb-files')); const offer = await peer.createOffer(); await peer.setLocalDescription(offer); signal({ description: peer.localDescription }); }
}
function setupChannel(nextChannel) {
  channel = nextChannel; channel.binaryType = 'arraybuffer'; channel.onopen = onConnected;
  channel.onmessage = ({ data }) => {
    if (typeof data === 'string') { const message = JSON.parse(data); if (message.type === 'file-meta') { received = []; receivedInfo = message; showProgress(message.name, 0, 'بدأ استقبال الملف…'); } if (message.type === 'file-complete') finishReceive(); return; }
    received.push(data); const size = received.reduce((total, chunk) => total + chunk.byteLength, 0); showProgress(receivedInfo.name, size / receivedInfo.size, 'جارٍ استقبال الملف…');
  };
}
async function handleSignalMessage(message) {
  if (message.type === 'room-created') { roomCode = message.code; const link = `${location.origin}${location.pathname}?room=${roomCode}`; $('shareLink').value = link; QRCode.toCanvas($('qrCanvas'), link, { width: 220, margin: 1, color: { dark: '#123b36', light: '#ffffff' } }); show('pairView'); return; }
  if (message.type === 'joined-room') { isReceiver = true; show('pairView'); setStatus('تم الربط، بانتظار الجهاز المُرسل…'); return; }
  if (message.type === 'peer-joined') { setStatus('تم ربط الجهاز الآخر. جارٍ إنشاء اتصال آمن…'); await makePeer(true); return; }
  if (message.type === 'signal') { const signalData = message.signal; if (signalData.description) { if (!peer) await makePeer(false); await peer.setRemoteDescription(signalData.description); if (signalData.description.type === 'offer') { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); signal({ description: peer.localDescription }); } } if (signalData.candidate) await peer.addIceCandidate(signalData.candidate); return; }
  if (message.type === 'error') setStatus(message.message, true);
  if (message.type === 'peer-left') setStatus('غادر الجهاز الآخر الجلسة.', true);
}
function onConnected() { show('transferView'); if (isReceiver) { $('transferTitle').textContent = 'الجهاز الآخر جاهز للإرسال'; $('transferDescription').textContent = 'سيظهر الملف هنا فور إرساله إليك.'; $('fileDrop').classList.add('hidden'); } }
function showProgress(name, fraction, text) { $('progressBox').classList.remove('hidden'); $('fileName').textContent = name; $('progressText').textContent = `${Math.round(fraction * 100)}%`; $('progressBar').style.width = `${fraction * 100}%`; $('transferStatus').textContent = text; }
function waitForBuffer() { return new Promise((resolve) => { const timer = setInterval(() => { if (channel.bufferedAmount < 128 * 1024) { clearInterval(timer); resolve(); } }, 40); }); }
async function sendFile(file) { if (!channel || channel.readyState !== 'open') return; $('downloadLink').classList.add('hidden'); showProgress(file.name, 0, 'بدأ إرسال الملف…'); channel.send(JSON.stringify({ type: 'file-meta', name: file.name, size: file.size, mime: file.type || 'application/octet-stream' })); const chunkSize = 16 * 1024; for (let offset = 0; offset < file.size; offset += chunkSize) { channel.send(await file.slice(offset, offset + chunkSize).arrayBuffer()); await waitForBuffer(); showProgress(file.name, Math.min((offset + chunkSize) / file.size, 1), 'جارٍ إرسال الملف مباشرة…'); } channel.send(JSON.stringify({ type: 'file-complete' })); $('transferStatus').textContent = 'تم إرسال الملف بنجاح.'; }
function finishReceive() { const blob = new Blob(received, { type: receivedInfo.mime }); const link = $('downloadLink'); link.href = URL.createObjectURL(blob); link.download = receivedInfo.name; link.textContent = `تنزيل ${receivedInfo.name}`; link.classList.remove('hidden'); showProgress(receivedInfo.name, 1, 'اكتمل استلام الملف.'); }
$('createRoom').addEventListener('click', async () => { try { await connect(); socket.send(JSON.stringify({ type: 'create-room' })); } catch (error) { alert(error.message); } });
$('joinRoom').addEventListener('click', async () => { const code = $('roomCode').value.trim(); if (!code) return; try { await connect(); socket.send(JSON.stringify({ type: 'join-room', code })); } catch (error) { alert(error.message); } });
$('copyLink').addEventListener('click', async () => { await navigator.clipboard.writeText($('shareLink').value); $('copyLink').textContent = 'تم النسخ'; setTimeout(() => { $('copyLink').textContent = 'نسخ الرابط'; }, 1500); });
$('fileInput').addEventListener('change', ({ target }) => { if (target.files[0]) sendFile(target.files[0]); });
['dragenter', 'dragover'].forEach((event) => $('fileDrop').addEventListener(event, (item) => { item.preventDefault(); $('fileDrop').classList.add('dragging'); }));
['dragleave', 'drop'].forEach((event) => $('fileDrop').addEventListener(event, (item) => { item.preventDefault(); $('fileDrop').classList.remove('dragging'); }));
$('fileDrop').addEventListener('drop', ({ dataTransfer }) => { if (dataTransfer.files[0]) sendFile(dataTransfer.files[0]); });
const initialRoom = new URLSearchParams(location.search).get('room'); if (initialRoom) { $('roomCode').value = initialRoom; $('joinRoom').click(); }
