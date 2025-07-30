// Receiver (final, with split layout in Debug):
// - WebRTC receive, event-driven video metadata -> build stereo planes
// - Debug mode: side-by-side planes (no XR), easy to see both eyes
// - XR mode: overlapped planes, per-eye layers
// - Runtime console helpers exposed via window.debug

import { VRButton } from 'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/webxr/VRButton.js';

const SIGNALING_URL = 'http://localhost:3000';
const socket = io(SIGNALING_URL);

// DOM
const roomIdInput = document.getElementById('roomId');
const joinBtn     = document.getElementById('joinBtn');
const enterXRBtn  = document.getElementById('enterXRBtn');
const debugBtn    = document.getElementById('debugBtn');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv   = document.getElementById('status');

// WebRTC
const pc = new RTCPeerConnection({ iceServers: [] });

// Three / XR state
let renderer, scene, camera;
let videoTexture, leftMesh, rightMesh;
let leftMat, rightMat;
let debugMode = false;          // true => normal canvas, side-by-side
let threeInitialized = false;
let planesBuilt = false;
let planeSize = { width: 0, height: 0 }; // meters

// ---------- status ----------
function setStatus(msg, color = 'white') {
  statusDiv.textContent = msg;
  statusDiv.style.color = color;
  console.log('[Receiver][STATUS]', msg);
}
function getVRButtonEl() {
  return document.querySelector('#VRButton') || document.querySelector('.vr-button');
}
function showVRButton(show) {
  const el = getVRButtonEl();
  if (el) el.style.display = show ? 'block' : 'none';
}

// ---------- Three.js ----------
function setupThree() {
  if (threeInitialized) return;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  // XR only when NOT in debug
  renderer.xr.enabled = !debugMode;

  // Canvas first
  document.body.appendChild(renderer.domElement);

  // VR button only in XR mode
  if (!debugMode) {
    document.body.appendChild(VRButton.createButton(renderer));
    showVRButton(true);
    console.log('[Receiver] VRButton appended (XR enabled).');
  } else {
    showVRButton(false);
    console.log('[Receiver] XR disabled (Debug mode).');
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 1.6, 0);

  const light = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(light);

  window.addEventListener('resize', () => {
    if (!renderer.xr.isPresenting) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }
  });

  threeInitialized = true;
  expose(); // make objects available to console
}

function buildStereoPlanesWithCurrentVideoSize() {
  if (planesBuilt) return;

  const vw = remoteVideo.videoWidth;
  const vh = remoteVideo.videoHeight;
  if (!vw || !vh) {
    console.error('[Receiver] Cannot build planes: invalid video size', { vw, vh });
    return;
  }
  console.log(`[Receiver] Video metadata ready. width=${vw}, height=${vh}`);

  videoTexture = new THREE.VideoTexture(remoteVideo);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.generateMipmaps = false;

  // SBS aspect: (vw/2)/vh
  const aspect = (vw / 2) / vh;
  const heightM = 1.5;            // start comfortably large
  const widthM  = aspect * heightM;
  planeSize = { width: widthM, height: heightM };

  const geo = new THREE.PlaneGeometry(widthM, heightM);

  // Materials sample each half of the SBS texture
  leftMat  = new THREE.MeshBasicMaterial({ map: videoTexture });
  leftMat.map.repeat.set(0.5, 1.0);
  leftMat.map.offset.set(0.0, 0.0);

  rightMat = new THREE.MeshBasicMaterial({ map: videoTexture });
  rightMat.map.repeat.set(0.5, 1.0);
  rightMat.map.offset.set(0.5, 0.0);

  leftMesh  = new THREE.Mesh(geo, leftMat);
  rightMesh = new THREE.Mesh(geo, rightMat);

  // Default positions will be finalized by layout function
  scene.add(leftMesh);
  scene.add(rightMesh);

  // Layers for XR (per-eye)
  leftMesh.layers.set(1);
  rightMesh.layers.set(2);

  // Per-eye layer routing for XR cameras
  renderer.xr.addEventListener('sessionstart', () => {
    const xrCam = renderer.xr.getCamera(camera);
    if (xrCam.cameras && xrCam.cameras.length === 2) {
      const camLeft  = xrCam.cameras[0];
      const camRight = xrCam.cameras[1];
      camLeft.layers.enable(1);  camLeft.layers.disable(2);
      camRight.layers.enable(2); camRight.layers.disable(1);
    }
  });

  // Apply layout for current mode (split vs overlapped)
  applyLayoutForMode();

  // Render loop
  renderer.setAnimationLoop(() => {
    if (debugMode) {
      // Normal camera renders both halves in Debug
      camera.layers.enableAll();
      if (videoTexture) videoTexture.needsUpdate = true;
    } else {
      // Normal camera neutral; XR sub-cameras do the per-eye work
      camera.layers.disable(1);
      camera.layers.disable(2);
    }
    renderer.render(scene, camera);
  });

  planesBuilt = true;
  expose();
}

// Split (Debug) vs Overlapped (XR) layout
function applyLayoutForMode() {
    if (!leftMesh || !rightMesh) return;
  
    const y = camera ? camera.position.y : 1.6;
    const z = -1.0;
  
    if (debugMode) {
      // Debug mode: side-by-side planes
      leftMesh.scale.set(1, 1, 1);
      rightMesh.scale.set(1, 1, 1);
  
      // Set positions for side-by-side layout
      const halfW = planeSize.width;
      const gap = 0; // no gap in debug mode
      leftMesh.position.set(-planeSize.width / 2, y, z);
      rightMesh.position.set(planeSize.width / 2, y, z);
  
    } else {
      // XR Mode: overlapped planes
      leftMesh.position.set(0, y, z);
      rightMesh.position.set(0, y, z);
    }
  }
  
  

// ---------- WebRTC ----------
async function joinAndAnswer(roomId) {
  setStatus(`Joining room "${roomId}"...`, 'deepskyblue');
  socket.emit('join', roomId, 'receiver');

  pc.ontrack = (e) => {
    console.log('[Receiver] ontrack fired');
    const [stream] = e.streams;
    remoteVideo.srcObject = stream;

    const onMeta = () => {
      remoteVideo.removeEventListener('loadedmetadata', onMeta);
      remoteVideo.removeEventListener('loadeddata', onMeta);
      console.log('[Receiver] onloadedmetadata/loadeddata fired.');
      remoteVideo.style.display = 'none'; // hide raw <video> by default
      if (!threeInitialized) setupThree();
      buildStereoPlanesWithCurrentVideoSize();
      remoteVideo.play().catch(() => {});
    };

    if (remoteVideo.videoWidth && remoteVideo.videoHeight) {
      onMeta();
    } else {
      remoteVideo.addEventListener('loadedmetadata', onMeta, { once: true });
      remoteVideo.addEventListener('loadeddata', onMeta, { once: true });
    }

    setStatus('Remote stream received. Preparing scene...', 'deepskyblue');
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice-candidate', { roomId, candidate: e.candidate });
  };

  pc.onconnectionstatechange = () => {
    console.log('[Receiver] PC state:', pc.connectionState);
    if (pc.connectionState === 'connected') {
      setStatus('✅ Peer connection established.', 'lightgreen');
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      setStatus(`⚠️ Connection state: ${pc.connectionState}`, 'orange');
    }
  };

  socket.on('offer', async ({ sdp }) => {
    console.log('[Receiver] Offer received');
    setStatus('Offer received. Creating answer...', 'deepskyblue');
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { roomId, sdp: answer });
    console.log('[Receiver] Answer sent.');
    setStatus('✅ Answer sent. Waiting for media...', 'lightgreen');
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log('[Receiver] Remote ICE added');
    } catch (e) {
      console.error('[Receiver] Error adding ICE candidate', e);
      setStatus('Error adding ICE candidate. See console.', 'orange');
    }
  });

  pc.addTransceiver('video', { direction: 'recvonly' });
}

// ---------- UI ----------
joinBtn.addEventListener('click', async () => {
  const roomId = (roomIdInput.value || '').trim() || 'demo';
  await joinAndAnswer(roomId);
  setStatus('Waiting for offer from publisher...', 'deepskyblue');
});

enterXRBtn.addEventListener('click', async () => {
  if (debugMode) {
    setStatus('Debug mode is ON. Turn it OFF to enter XR.', 'khaki');
    return;
  }
  if (!threeInitialized) setupThree();
  const btn = getVRButtonEl();
  if (btn) btn.click();
});

debugBtn.addEventListener('click', async () => {
  debugMode = !debugMode;
  setStatus(debugMode ? 'Debug mode ON (no XR).' : 'Debug mode OFF. XR enabled if available.', debugMode ? 'khaki' : 'white');

  // End XR session if any, then reconfigure renderer
  if (renderer && renderer.xr && renderer.xr.getSession()) {
    try { await renderer.xr.getSession().end(); } catch {}
  }

  if (!threeInitialized) {
    setupThree();
  } else {
    renderer.xr.enabled = !debugMode;
    showVRButton(!debugMode);
    applyLayoutForMode(); // re-layout planes for current mode
  }

  // Optional: show raw <video> in debug for quick verification (toggle from console)
  remoteVideo.style.display = debugMode ? 'none' : 'none';

  // If stream is ready but planes not built (rare), build now
  if (!planesBuilt && remoteVideo.srcObject && remoteVideo.videoWidth && remoteVideo.videoHeight) {
    buildStereoPlanesWithCurrentVideoSize();
  }

  expose();
});

// Socket status
socket.on('connect', () => setStatus('Signaling connected. Ready to join.', 'deepskyblue'));
socket.on('disconnect', () => setStatus('Signaling disconnected.', 'orange'));

// ---------- Runtime console helpers ----------
function expose() {
  window.debug = {
    // raw objects
    scene, camera, leftMesh, rightMesh, remoteVideo, videoTexture, renderer, leftMat, rightMat,
    // info dump
    info() {
      const vw = remoteVideo?.videoWidth, vh = remoteVideo?.videoHeight;
      const cam = camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null;
      const lm  = leftMesh  ? { x: leftMesh.position.x,  y: leftMesh.position.y,  z: leftMesh.position.z }  : null;
      const rm  = rightMesh ? { x: rightMesh.position.x, y: rightMesh.position.y, z: rightMesh.position.z } : null;
      console.table({ videoWidth: vw, videoHeight: vh, planeWidthM: planeSize.width, planeHeightM: planeSize.height, camera: JSON.stringify(cam), leftMesh: JSON.stringify(lm), rightMesh: JSON.stringify(rm), debugMode });
    },
    // move both
    setPlanePos(x=0, y=1.6, z=-1) {
      if (leftMesh && rightMesh) {
        leftMesh.position.set(x,y,z);
        rightMesh.position.set(x,y,z);
      }
    },
    // move individually (to verify which is which)
    setLeftPos(x=0, y=1.6, z=-1)  { if (leftMesh)  leftMesh.position.set(x,y,z);  },
    setRightPos(x=0, y=1.6, z=-1) { if (rightMesh) rightMesh.position.set(x,y,z); },
    // scale
    setPlaneScale(sx=1, sy=1) {
      if (leftMesh && rightMesh) {
        leftMesh.scale.set(sx, sy, 1);
        rightMesh.scale.set(sx, sy, 1);
      }
    },
    // tint materials to distinguish (red = left, green = right)
    tint(on=true) {
      if (!leftMat || !rightMat) return;
      leftMat.color.set(on ? 0xff6666 : 0xffffff);
      rightMat.color.set(on ? 0x66ff66 : 0xffffff);
    },
    // toggle split/overlap manually
    separate() { debugMode = true; if (renderer) { renderer.xr.enabled = false; showVRButton(false); } applyLayoutForMode(); },
    overlap()  { debugMode = false; if (renderer) { renderer.xr.enabled = true;  showVRButton(true);  } applyLayoutForMode(); },
    // raw <video> visibility
    showVideo(show=true) {
      remoteVideo.style.display = show ? 'block' : 'none';
      if (show) { remoteVideo.style.position='fixed'; remoteVideo.style.right='10px'; remoteVideo.style.bottom='10px'; remoteVideo.style.width='320px'; remoteVideo.style.zIndex='9999'; }
    },
    layersAll()   { if (camera) camera.layers.enableAll(); },
    forceUpdate() { if (videoTexture) videoTexture.needsUpdate = true; }
  };
  console.log('%cRuntime helpers available as "debug"', 'color:#0f0');
}
