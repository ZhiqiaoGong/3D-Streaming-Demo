// Browser-side Publisher logic.
// - Loads a local SBS video file into a <video> element.
// - Uses HTMLVideoElement.captureStream() to obtain a MediaStream.
// - Creates a WebRTC RTCPeerConnection and sends the video track(s) to the Receiver.
// - Signaling (offer/answer/ICE) is relayed via the Socket.IO server.

const SIGNALING_URL = 'http://localhost:3000'; // Change to LAN IP if testing across devices.
const socket = io(SIGNALING_URL);

// For local/LAN demos, STUN/TURN servers are often unnecessary.
// If test across NATs, uncomment the STUN server below.
// const pc = new RTCPeerConnection({
//   iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
// });
const pc = new RTCPeerConnection({ iceServers: [] });

// DOM elements
const fileInput = document.getElementById('fileInput');
const startBtn = document.getElementById('startBtn');
const roomIdInput = document.getElementById('roomId');
const videoEl = document.getElementById('video');
const statusDiv = document.getElementById('status'); // <div id="status"></div> in HTML

// State
let roomId = 'demo';
let lastOffer = null;
let started = false;

// Helpers
function setStatus(msg, color = 'green') {
  if (!statusDiv) return;
  statusDiv.innerText = msg;
  statusDiv.style.color = color;
  // Also log for debugging
  console.log('[Publisher][STATUS]', msg);
}

// Enable the start button after a video file is selected and metadata is known.
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  videoEl.src = url;

  videoEl.onloadedmetadata = () => {
    startBtn.disabled = false;
    setStatus('Video loaded. Ready to publish...', 'blue');
  };
});

// Main click handler to start publishing
startBtn.addEventListener('click', async () => {
  if (started) {
    setStatus('Already publishing. If you need to restart, refresh the page.', 'blue');
    return;
  }

  try {
    roomId = (roomIdInput.value || '').trim() || 'demo';
    setStatus(`Joining room "${roomId}"...`, 'blue');
    socket.emit('join', roomId, 'publisher');

    // Some browsers require user gesture to play.
    setStatus('Attempting to play the selected video...', 'blue');
    await videoEl.play();

    // Capture a MediaStream from the <video>.
    const stream =
      videoEl.captureStream ? videoEl.captureStream() :
      videoEl.mozCaptureStream ? videoEl.mozCaptureStream() : null;

    if (!stream) {
      setStatus('captureStream() is unavailable. Please use a modern Chromium-based browser.', 'red');
      alert('captureStream() is unavailable in this browser. Please use a modern Chromium-based browser.');
      return;
    }

    // Add tracks to the PeerConnection
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    // Forward local ICE candidates to the remote peer via the signaling server.
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('ice-candidate', { roomId, candidate: e.candidate });
      }
    };

    // Create and send the SDP offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    lastOffer = offer;
    socket.emit('offer', { roomId, sdp: offer });
    console.log('[Publisher] Offer sent.');
    setStatus('✅ Publishing started. Waiting for receiver to join...', 'green');

    started = true;
  } catch (err) {
    console.error('[Publisher] Failed to start publishing:', err);
    setStatus(`❌ Failed to start publishing: ${err?.message || err}`, 'red');
    alert('Failed to start publishing. See console for details.');
  }
});

// Late-join handling: if a receiver joins after we already sent an offer,
// re-send the last offer so they can answer.
socket.on('peer-joined', (role) => {
  console.log('[Publisher] peer-joined:', role);
  if (role === 'receiver' && lastOffer) {
    socket.emit('offer', { roomId, sdp: lastOffer });
    setStatus('📡 Receiver joined. Re-sent offer.', 'blue');
  }
});

// When the Receiver responds with an SDP answer, set it as the remote description.
socket.on('answer', async ({ sdp }) => {
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    console.log('[Publisher] Answer set.');
    setStatus('✅ Connected to receiver!', 'green');
  } catch (err) {
    console.error('[Publisher] Error setting remote description:', err);
    setStatus(`❌ Error setting remote description: ${err?.message || err}`, 'red');
  }
});

// When the remote peer sends ICE candidates, add them to our connection.
socket.on('ice-candidate', async ({ candidate }) => {
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('[Publisher] Error adding remote ICE candidate:', err);
  }
});

// Optional: show connectivity state changes for quick debugging.
pc.onconnectionstatechange = () => {
  console.log('[Publisher] PC state:', pc.connectionState);
  if (pc.connectionState === 'connected') {
    setStatus('✅ Peer connection established.', 'green');
  } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
    setStatus(`⚠️ Connection state: ${pc.connectionState}`, 'orange');
  }
};

// Optional: indicate signaling socket status
socket.on('connect', () => setStatus('Signaling connected. Ready.', 'blue'));
socket.on('disconnect', () => setStatus('Signaling disconnected.', 'orange'));
