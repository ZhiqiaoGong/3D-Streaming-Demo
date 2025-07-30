// Receiver with:
// - WebRTC auto-reconnect (waits for network to come back before rejoining)
// - Debug mode: side-by-side preview with "contain" auto-fit (UNCHANGED SIZE)
// - XR mode: overlapped planes with per-eye layers and "contain" fit
//   (XR size tuned to be larger but never cropped)
// - Layout is recomputed on XR session start/end to handle XR FOV/aspect changes

import { VRButton } from 'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/jsm/webxr/VRButton.js';


const XR_WIDTH_FILL  = 0.98; // portion of visible width to occupy in XR (0.98 = 98%)
const XR_HEIGHT_FILL = 0.98; // max portion of visible height in XR

// Signaling
const SIGNALING_URL = 'http://localhost:3000';
const socket = io(SIGNALING_URL, { autoConnect: true });

// DOM
const roomIdInput = document.getElementById('roomId');
const joinBtn     = document.getElementById('joinBtn');
const enterXRBtn  = document.getElementById('enterXRBtn');
const debugBtn    = document.getElementById('debugBtn');
const remoteVideo = document.getElementById('remoteVideo');
const statusDiv   = document.getElementById('status');

// Three/XR state 
let renderer, scene, camera;
let videoTexture, leftMesh, rightMesh;
let leftMat, rightMat;
let threeInitialized = false;
let planesBuilt = false;
let debugMode = false;                   // Debug = true → side-by-side preview, no XR
let planeSize = { width: 0, height: 0 }; // unscaled plane size in meters

// WebRTC state 
let roomId = 'demo';
let pc = null;

// UI helpers 
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

// Network helper 
function waitForOnline() {
  return new Promise((resolve) => {
    if (navigator.onLine) return resolve();
    console.log('[Receiver] Waiting for network...');
    window.addEventListener('online', () => {
      console.log('[Receiver] Network is back.');
      resolve();
    }, { once: true });
  });
}

// FOV/frustum helpers 
function getCameraFovDeg(cam) {
  if (typeof cam.fov === 'number') return cam.fov;
  const m = cam.projectionMatrix?.elements;
  if (!m) return 70;
  const f = m[5];
  const fovRad = 2 * Math.atan(1 / f);
  return THREE.MathUtils.radToDeg(fovRad);
}
function visibleSizeAtZ(cam, zAbs) {
  const fovDeg = getCameraFovDeg(cam);
  const fovRad = THREE.MathUtils.degToRad(fovDeg);
  const visH   = 2 * zAbs * Math.tan(fovRad / 2);
  const visW   = visH * (cam.aspect || (window.innerWidth / window.innerHeight));
  return { visW, visH };
}

// Three setup 
function setupThree() {
  if (threeInitialized) return;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = !debugMode;

  document.body.appendChild(renderer.domElement);

  if (!debugMode) {
    document.body.appendChild(VRButton.createButton(renderer));
    showVRButton(true);
  } else {
    showVRButton(false);
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101010);

  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 1.6, 0);

  const light = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(light);

  // Re-fit while in non‑XR (XR uses its own cameras)
  window.addEventListener('resize', () => {
    if (!renderer.xr.isPresenting) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      applyLayoutForMode();
    }
  });

  // XR session start/end → recompute layout for XR/Screen cameras
  renderer.xr.addEventListener('sessionstart', () => {
    const xrCam = renderer.xr.getCamera(camera);
    if (xrCam.cameras && xrCam.cameras.length === 2) {
      const camLeft  = xrCam.cameras[0];
      const camRight = xrCam.cameras[1];
      camLeft.layers.enable(1);  camLeft.layers.disable(2);
      camRight.layers.enable(2); camRight.layers.disable(1);
    }
    applyLayoutForMode();
  });
  renderer.xr.addEventListener('sessionend', () => {
    applyLayoutForMode();
  });

  threeInitialized = true;
  expose(); // console helpers
}

// Build stereo planes 
function buildStereoPlanesWithCurrentVideoSize() {
  if (planesBuilt) return;

  const vw = remoteVideo.videoWidth;
  const vh = remoteVideo.videoHeight;
  if (!vw || !vh) {
    console.error('[Receiver] Invalid video size', { vw, vh });
    return;
  }

  videoTexture = new THREE.VideoTexture(remoteVideo);
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;
  videoTexture.generateMipmaps = false;

  // Half width per eye for SBS
  const aspect  = (vw / 2) / vh;
  const heightM = 1.5;               // base size (scaled by layout)
  const widthM  = aspect * heightM;
  planeSize = { width: widthM, height: heightM };

  const geo = new THREE.PlaneGeometry(widthM, heightM);

  leftMat  = new THREE.MeshBasicMaterial({ map: videoTexture });
  leftMat.map.repeat.set(0.5, 1.0);
  leftMat.map.offset.set(0.0, 0.0);

  rightMat = new THREE.MeshBasicMaterial({ map: videoTexture });
  rightMat.map.repeat.set(0.5, 1.0);
  rightMat.map.offset.set(0.5, 0.0);

  leftMesh  = new THREE.Mesh(geo, leftMat);
  rightMesh = new THREE.Mesh(geo, rightMat);
  scene.add(leftMesh); scene.add(rightMesh);

  // Per‑eye layers (XR)
  leftMesh.layers.set(1);
  rightMesh.layers.set(2);

  applyLayoutForMode();

  // Render loop (uses XR frame loop when in XR)
  renderer.setAnimationLoop(() => {
    if (debugMode) {
      camera.layers.enableAll();
      if (videoTexture) videoTexture.needsUpdate = true;
    } else {
      camera.layers.disable(1);
      camera.layers.disable(2);
    }
    renderer.render(scene, camera);
  });

  planesBuilt = true;
  expose();
}

// Layout 
function applyLayoutForMode() {
  if (!leftMesh || !rightMesh) return;

  // XR has priority: if in XR, we always use the XR branch regardless of debugMode
  const inXR = !!(renderer && renderer.xr && renderer.xr.isPresenting);
  const useDebugLayout = !inXR && debugMode;

  const y    = camera ? camera.position.y : 1.6;
  const z    = -0.7;         // negative Z (forward in camera space)
  const zAbs = Math.abs(z);

  const srcW = planeSize.width;
  const srcH = planeSize.height;
  const srcAspect = srcW / srcH;

  if (useDebugLayout) {
    // ---------- DEBUG: side-by-side, contain-fit ----------
    const { visW, visH } = visibleSizeAtZ(camera, zAbs);

    const pairW      = visW * 0.95;
    const singleW    = pairW / 2;
    let   singleH    = singleW / srcAspect;
    const maxSingleH = visH * 0.95;

    let scaleX = singleW / srcW;
    let scaleY = singleH / srcH;
    if (singleH > maxSingleH) {
      const k = maxSingleH / singleH;
      scaleX *= k; scaleY *= k; singleH *= k;
    }

    leftMesh.scale.set(scaleX, scaleY, 1);
    rightMesh.scale.set(scaleX, scaleY, 1);

    leftMesh.position.set(-singleW / 2, y, z);
    rightMesh.position.set( singleW / 2, y, z);

  } else {
    // ---------- XR: overlapped, contain-fit with larger fill but never cropped ----------
    let camForSizing = camera;
    if (inXR) {
      const xrCam = renderer.xr.getCamera(camera);
      camForSizing = (xrCam.cameras && xrCam.cameras.length > 0) ? xrCam.cameras[0] : xrCam;
    }

    const { visW, visH } = visibleSizeAtZ(camForSizing, zAbs);

    // Larger but safe: fill most of the visible width, limited by visible height.
    const targetW = visW * XR_WIDTH_FILL;
    let   targetH = targetW / srcAspect;

    const maxH    = visH * XR_HEIGHT_FILL;

    let scaleX = targetW / srcW;
    let scaleY = targetH / srcH;
    if (targetH > maxH) {
      const k = maxH / targetH; // shrink uniformly to fit height
      scaleX *= k; scaleY *= k; targetH *= k;
    }

    leftMesh.scale.set(scaleX, scaleY, 1);
    rightMesh.scale.set(scaleX, scaleY, 1);

    // Overlapped at the same position; XR per-eye layers decide visibility
    leftMesh.position.set(0, y, z);
    rightMesh.position.set(0, y, z);
  }
}

// WebRTC (auto‑reconnect) 
function createPeer() {
  if (pc) { try { pc.close(); } catch {} }
  pc = new RTCPeerConnection({ iceServers: [] });

  pc.ontrack = (e) => {
    const [stream] = e.streams;
    remoteVideo.srcObject = stream;

    const onMeta = () => {
      remoteVideo.removeEventListener('loadedmetadata', onMeta);
      remoteVideo.removeEventListener('loadeddata', onMeta);
      remoteVideo.style.display = 'none';
      if (!threeInitialized) setupThree();
      buildStereoPlanesWithCurrentVideoSize();
      remoteVideo.play().catch(() => {});
    };

    if (remoteVideo.videoWidth && remoteVideo.videoHeight) onMeta();
    else {
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
      return;
    }

    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      setStatus(`Connection ${pc.connectionState}. Rejoining...`, 'orange');

      // Dispose current pc and wait until we are back online, then rejoin.
      try { pc.close(); } catch {}
      pc = null;

      waitForOnline().then(() => {
        setStatus('Network back. Rejoining...', 'deepskyblue');
        setTimeout(() => {
          socket.emit('join', roomId, 'receiver'); // server will request a fresh offer from publisher
          setStatus('Waiting for new offer from publisher...', 'deepskyblue');
        }, 800);
      });
    }
  };
}

async function joinAndAnswer(rid) {
  roomId = rid;
  setStatus(`Joining room "${roomId}"...`, 'deepskyblue');

  createPeer();
  socket.emit('join', roomId, 'receiver');

  // Avoid duplicate handlers across re-joins
  socket.off('offer');
  socket.on('offer', async ({ sdp }) => {
    console.log('[Receiver] Offer received');
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { roomId, sdp: answer });
    setStatus('✅ Answer sent. Waiting for media...', 'lightgreen');
  });

  socket.off('ice-candidate');
  socket.on('ice-candidate', async ({ candidate }) => {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (e) { console.error('[Receiver] addIceCandidate error', e); }
  });
}

// UI 
joinBtn.addEventListener('click', async () => {
  const rid = (roomIdInput.value || '').trim() || 'demo';
  await joinAndAnswer(rid);
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
  // Some emulators need a small delay before XR cameras are active
  setTimeout(() => applyLayoutForMode(), 200);
});

debugBtn.addEventListener('click', async () => {
  debugMode = !debugMode;
  setStatus(debugMode ? 'Debug mode ON (no XR).' : 'Debug mode OFF. XR enabled if available.', debugMode ? 'khaki' : 'white');

  if (renderer && renderer.xr && renderer.xr.getSession()) {
    try { await renderer.xr.getSession().end(); } catch {}
  }
  if (!threeInitialized) setupThree();

  renderer.xr.enabled = !debugMode;
  showVRButton(!debugMode);
  applyLayoutForMode();

  if (!planesBuilt && remoteVideo.srcObject && remoteVideo.videoWidth && remoteVideo.videoHeight) {
    buildStereoPlanesWithCurrentVideoSize();
  }
});

// Socket auto-rejoin 
socket.on('connect', () => {
  setStatus('Signaling connected. Ready.', 'deepskyblue');
  if (roomId) socket.emit('join', roomId, 'receiver'); // auto re-join last room on reconnect
});
socket.on('disconnect', () => setStatus('Signaling disconnected.', 'orange'));

// Console helpers 
function expose() {
  window.debug = {
    scene, camera, leftMesh, rightMesh, remoteVideo, videoTexture,
    info() {
      const vw = remoteVideo?.videoWidth, vh = remoteVideo?.videoHeight;
      console.table({
        videoWidth: vw, videoHeight: vh,
        planeWidthM: planeSize.width, planeHeightM: planeSize.height,
        debugMode,
        leftPos: leftMesh?.position, rightPos: rightMesh?.position
      });
    },
    tint(on=true) {
      if (leftMat && rightMat) {
        leftMat.color.set(on ? 0xff6666 : 0xffffff);
        rightMat.color.set(on ? 0x6666ff : 0xffffff);
      }
    }
  };
  console.log('%cUse "debug.info()" and "debug.tint()" in console.', 'color:#0f0');
}
