## **3D Streaming Demo (Publisher + Receiver)**

This is a minimal **WebRTC-based 3D streaming demo**:
- **Publisher**: Streams a side-by-side (SBS) stereo video over WebRTC.
- **Receiver**: Displays the stream in **WebXR** (left eye sees left half, right eye sees right half).
- Supports **Debug mode** (side-by-side preview in browser) and **real XR mode** (with proper per-eye layers).
- Includes **auto-reconnect** (on network failure) and **WebXR Emulator compatibility**.

---

### **1. Features**

- 📡 **WebRTC Streaming** (Publisher ↔ Receiver with Socket.IO signaling)
- 🕶️ **XR Mode**: Overlapped planes + per-eye layers  
- 🖥️ **Debug Mode**: Side-by-side preview (for browsers without XR)
- 🔁 **Auto-reconnect**: Recovers from network or peer disconnects
- 🖍️ **Debug Tint**: Red/Blue overlay to verify left/right eye separation
- 🛡️ **Safe Scaling**:
  - XR: Plane fills ~98% of FOV, but **never cropped** (adjustable in `XR_WIDTH_FILL` & `XR_HEIGHT_FILL`)
  - Debug: Contain-fit for both eyes side-by-side (unchanged)

---

### **2. Folder Structure**

```
.
├── server/           # Socket.IO signaling server
│   └── index.js
├── publisher/        # Publisher UI
│   ├── index.html
│   └── main.js
└── receiver/         # Receiver UI (WebXR + Debug)
    ├── index.html
    └── main.js       # latest version with XR scaling tuned
```

---

### **3. How to Run**

#### **1) Install & Run the signaling server**
```bash
cd server
npm install express socket.io
node index.js
```
- Default: runs on `http://localhost:3000`

#### **2) Run Publisher**
```bash
cd publisher
npx serve -p 5173
# open http://localhost:5173 in Chrome/Firefox
```
- Select an **SBS stereo video** (e.g. `video.mp4`)  
- Click **Start Publish**

#### **3) Run Receiver**
```bash
cd receiver
npx serve -p 5174
# open http://localhost:5174
```
- Enter the same room ID (default: `demo`)
- Click **Join**
- You can:
  - **Debug mode**: Click `Toggle Debug` (side-by-side preview)
  - **XR mode**: Turn Debug OFF → Click `Enter XR` (use headset or WebXR Emulator)

---

### **4. Controls (Receiver)**

- **Join**: connect to signaling room
- **Enter XR**: start immersive XR session (if supported)
- **Toggle Debug (No XR)**: side-by-side browser preview
- **Debug Tint (Console)**:
  ```js
  debug.tint(true)   // left eye = red, right eye = blue
  debug.tint(false)  // reset colors
  debug.info()       // print current plane scales and positions
  ```

---

### **5. Emulator vs Real XR**

#### **WebXR Emulator (Chrome/Firefox)**
- Shows **two views side-by-side** (left eye + right eye) in browser window  
- Plane size changes **may not be visually obvious** (Emulator re-scales internally)
- Use `debug.info()` to see scale values instead

#### **Real XR Device (Quest / Pico / Vision Pro)**
- XR mode: **one overlapped plane** (per-eye layers select left/right half)
- `XR_WIDTH_FILL` & `XR_HEIGHT_FILL` in `receiver/main.js` affect perceived size  
- Adjust:
  ```js
  const XR_WIDTH_FILL  = 0.98; // fraction of visible width
  const XR_HEIGHT_FILL = 0.98; // fraction of visible height
  ```
  - ↑ Larger (1.0 = max, might slightly crop)
  - ↓ Smaller, guaranteed safe

---

### **6. Known Behaviors**

1. **SBS video is one-shot**: After a Publisher stops, you must reload it and re-Start.
2. **Auto-reconnect**:
   - If Receiver disconnects: it will re-join when network is back
   - Publisher will re-offer when requested
   - Playback restarts from the beginning of the video
3. Emulator preview **always side-by-side**; this is expected.

---

### **7. Commands Recap**

**Publisher** (port 5173):
```bash
cd publisher && npx serve -p 5173
```

**Receiver** (port 5174):
```bash
cd receiver && npx serve -p 5174
```

**Server** (port 3000):
```bash
cd server && node index.js
```

---

### **8. Architecture Diagram**

```
[SBS Video File] → Publisher (WebRTC offer)
         ↓
   Socket.IO Server (signaling)
         ↓
Receiver (WebXR):
- XR Mode (per-eye layers)
- Debug Mode (side-by-side)
```

---

### **9. Debugging Tips**

- **Check XR mode status**:  
  ```js
  renderer.xr.isPresenting // true = XR active, false = Debug/browser only
  ```
- **Emulator shows two views side-by-side** even in XR mode. Real XR headsets see only one fused view.
- If XR view feels small, tweak `XR_WIDTH_FILL` to `0.99` or `1.0` and test on real device.

---

> This README matches the latest code base (with XR sizing tuned).
