// Minimal signaling server using Express + Socket.IO.
// It only relays SDP offers/answers and ICE candidates between peers in the same room.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // Allow dev-time cross-origin requests from local file servers.

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Each WebSocket connection can "join" a logical room (string roomId).
io.on('connection', (socket) => {
  // Client tells us which room it wants to join and its role (publisher/receiver).
  socket.on('join', (roomId, role) => {
    socket.join(roomId);
    socket.data = { roomId, role };
    // Notify the other peer in the same room that someone joined (optional, for debugging/UI).
    socket.to(roomId).emit('peer-joined', role);
  });

  // Publisher sends an SDP offer; we forward it to the other peer in the room.
  socket.on('offer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('offer', { sdp });
  });

  // Receiver sends an SDP answer; we forward it to the publisher.
  socket.on('answer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('answer', { sdp });
  });

  // Both peers exchange ICE candidates through the server.
  socket.on('ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('ice-candidate', { candidate });
  });

  // Inform the room the peer has left (optional).
  socket.on('disconnect', () => {
    const roomId = socket?.data?.roomId;
    if (roomId) socket.to(roomId).emit('peer-left');
  });
});

// Simple liveness endpoint.
app.get('/', (_, res) => res.send('Signaling server is running'));

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Signaling server: http://localhost:${PORT}`);
});
