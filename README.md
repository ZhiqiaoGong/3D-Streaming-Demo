# 3D Streaming Demo (Publisher + Receiver)

This is a minimal WebRTC-based 3D streaming demo.  
It reads a local **Side-by-Side (SBS)** stereo video on the Publisher side and streams it via WebRTC.  
The Receiver splits the left/right halves and displays them in **WebXR** (VR) or Debug mode.

---

## **Features**

### Publisher
- Select a local SBS (side-by-side) stereo video and stream via WebRTC.
- Uses `captureStream()` from `<video>` element to generate a MediaStream.
- Loops video playback so the stream remains active.

### Receiver
- Receives the WebRTC stream and splits left/right halves.
- **WebXR Mode**:
  - Overlaps left/right planes and uses `layers` so each eye only sees its corresponding half.
  - Works in **Firefox** with the [WebXR API Emulator](https://addons.mozilla.org/en-US/firefox/addon/webxr-api-emulator/) or a real XR device.
- **Debug Mode**:
  - Works on **any modern browser** (Chrome/Edge/Firefox).
  - Shows left and right planes side-by-side (no XR needed).
  - Automatic aspect-ratio fitting so any video ratio works.

### Signaling
- A lightweight Socket.IO server handles:
  - `join` / `offer` / `answer` / `ice-candidate` events.
- Works on local/LAN network; no NAT traversal required.

---

## **Project Structure**

```
project/
├── server/             # Node.js signaling server (Socket.IO)
│   └── index.js
├── publisher/          # Publisher UI
│   ├── index.html
│   └── main.js
├── receiver/           # Receiver UI (WebXR)
│   ├── index.html
│   └── main.js
├── README.md
└── .gitignore
```

---

## **Getting Started**

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Signaling Server
```bash
node server/index.js
```
Server defaults to `http://localhost:3000`.

### 3. Start Publisher
Open `publisher/index.html` in a browser:
1. Select an SBS stereo video file.
2. Click **Start Publish**.

### 4. Start Receiver
Open `receiver/index.html` in another tab or device:
1. Enter the same **Room ID** as the Publisher (default: `demo`).
2. Click **Join**.
3. Choose:
   - **Enter XR** → Runs in WebXR mode (Firefox + XR device or WebXR Emulator).
   - **Toggle Debug** → Works in any browser; shows left/right planes side-by-side.

---

## **Testing with WebXR API Emulator (Firefox)**

1. Install the [WebXR API Emulator for Firefox](https://addons.mozilla.org/en-US/firefox/addon/webxr-api-emulator/).
2. Start Receiver → Click **Enter XR** (VR button).
3. Open the Emulator panel and:
   - Drag the headset model to rotate.
   - Use arrow/WASD/QE keys to move.
   - Add virtual controllers if needed.

**Note:** In Emulator mode, the canvas will show **side-by-side eye views**.  
In a real XR headset, each eye only sees its half.

---

## **Design Trade-offs**

- Only supports **one Publisher ↔ one Receiver** per session.
- No reconnect logic: refreshing either page requires re-joining the room.
- Uses local `<video>` capture; not optimized for live camera feeds.

---

## **Future Improvements**

- Support multiple Receivers and better reconnection handling.
- Add UI feedback (connection status, error states).
- Deploy signaling server to a public service (Render/Vercel).

---

## **Author**

Created as a minimum functional demo for 3D streaming and WebXR integration.
