// Publisher with auto-reconnect and looped local video.
// - User selects a local SBS file
// - We capture a MediaStream from <video> and publish via WebRTC
// - On receiver rejoin or socket reconnect, we re-offer automatically
// - On network loss, we wait until back online before re-negotiating

const SIGNALING_URL = 'http://localhost:3000';
const socket = io(SIGNALING_URL, { autoConnect: true });

const fileInput = document.getElementById('fileInput');
const startBtn  = document.getElementById('startBtn');
const roomInput = document.getElementById('roomId');
const videoEl   = document.getElementById('video');
const statusEl  = document.getElementById('status');

let roomId = 'demo';
let pc = null;
let localStream = null;
let started = false;        // true after user selected a file and clicked Start
let pendingNegotiate = false;

function setStatus(msg, color = 'black') {
  statusEl.textContent = msg;
  statusEl.style.color = color;
  console.log('[Publisher][STATUS]', msg);
}

function waitForOnline() {
  return new Promise((resolve) => {
    if (navigator.onLine) return resolve();
    console.log('[Publisher] Waiting for network...');
    window.addEventListener('online', () => {
      console.log('[Publisher] Network is back.');
      resolve();
    }, { once: true });
  });
}

// Enable Start when a file is chosen
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  videoEl.src = url;
  videoEl.loop = true; // loop for demo stability
  videoEl.onloadedmetadata = () => {
    startBtn.disabled = false;
    setStatus('Video selected. Ready to publish.');
  };
});

startBtn.addEventListener('click', async () => {
  roomId = (roomInput.value || '').trim() || 'demo';
  socket.emit('join', roomId, 'publisher');
  setStatus(`Joining room "${roomId}" as publisher...`, 'deepskyblue');

  try { await videoEl.play(); } catch {}

  localStream =
    videoEl.captureStream ? videoEl.captureStream() :
    videoEl.mozCaptureStream ? videoEl.mozCaptureStream() : null;

  if (!localStream) {
    setStatus('captureStream() not available in this browser.', 'crimson');
    alert('Use a modern Chromium/Firefox browser.');
    return;
  }
  started = true;

  await waitForOnline();
  await createPeerAndNegotiate();
});

async function createPeerAndNegotiate() {
  if (!navigator.onLine) await waitForOnline();

  // Dispose old pc if any
  if (pc) { try { pc.close(); } catch {} }

  pc = new RTCPeerConnection({ iceServers: [] });

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice-candidate', { roomId, candidate: e.candidate });
  };

  pc.onconnectionstatechange = async () => {
    console.log('[Publisher] PC state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      setStatus('✅ Connected to receiver.', 'lightgreen');
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      setStatus(`Connection ${pc.connectionState}. Trying to recover...`, 'orange');
      if (!localStream) return;
      await waitForOnline();
      // Recreate + reoffer
      await createPeerAndNegotiate();
    }
  };

  // Add local tracks
  if (localStream) {
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { roomId, sdp: offer });
  setStatus('Offer sent. Waiting for answer...', 'deepskyblue');
}

socket.on('answer', async ({ sdp }) => {
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    setStatus('✅ Answer set. Streaming...', 'lightgreen');
  } catch (e) {
    console.error('[Publisher] setRemoteDescription error:', e);
  }
});

socket.on('ice-candidate', async ({ candidate }) => {
  try { await pc?.addIceCandidate(new RTCIceCandidate(candidate)); }
  catch (e) { console.error('[Publisher] addIceCandidate error:', e); }
});

// Server asks us to re-offer (e.g., a receiver joined/rejoined)
socket.on('request-offer', async ({ roomId: r }) => {
  if (!started || !localStream) return;
  if (r && r !== roomId) return;
  if (pendingNegotiate) return;
  pendingNegotiate = true;
  try {
    await waitForOnline();
    await createPeerAndNegotiate();
  } finally {
    pendingNegotiate = false;
  }
});

// Socket lifecycle
socket.on('connect', () => {
  setStatus('Signaling connected.', 'deepskyblue');
  if (started) socket.emit('join', roomId, 'publisher');
});
socket.on('disconnect', () => setStatus('Signaling disconnected.', 'orange'));
