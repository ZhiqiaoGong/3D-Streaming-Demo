// Minimal Socket.IO signaling server with room/role tracking.
// - Tracks which socket is the publisher in each room
// - When a receiver joins (or rejoins), asks the publisher to (re)send an offer
// - Relays offer/answer/ICE between peers in the same room
//
// Usage:
//   node index.js
//   => http://localhost:3000

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// rooms[roomId] = { publisher: <socketId|null>, receivers: Set<socketId> }
const rooms = {};

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', (roomId, role) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;

    if (!rooms[roomId]) {
      rooms[roomId] = { publisher: null, receivers: new Set() };
    }

    if (role === 'publisher') {
      rooms[roomId].publisher = socket.id;
      console.log(`[room:${roomId}] publisher joined: ${socket.id}`);
      socket.to(roomId).emit('publisher-joined');
    } else {
      rooms[roomId].receivers.add(socket.id);
      console.log(`[room:${roomId}] receiver joined: ${socket.id}`);

      const pubId = rooms[roomId].publisher;
      if (pubId) {
        // Ask the publisher to (re)negotiate for this room.
        io.to(pubId).emit('request-offer', { roomId, receiverId: socket.id });
      }
    }
  });

  socket.on('offer', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('offer', payload);
  });

  socket.on('answer', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('answer', payload);
  });

  socket.on('ice-candidate', (payload) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('ice-candidate', payload);
  });

  socket.on('disconnect', () => {
    const { roomId, role } = socket.data || {};
    console.log('Socket disconnected:', socket.id, roomId, role);

    if (roomId && rooms[roomId]) {
      if (role === 'publisher' && rooms[roomId].publisher === socket.id) {
        rooms[roomId].publisher = null;
        socket.to(roomId).emit('publisher-left');
      } else if (role === 'receiver') {
        rooms[roomId].receivers.delete(socket.id);
        socket.to(roomId).emit('receiver-left', { receiverId: socket.id });
      }

      // Optional cleanup
      if (!rooms[roomId].publisher && rooms[roomId].receivers.size === 0) {
        delete rooms[roomId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening at http://localhost:${PORT}`);
});
