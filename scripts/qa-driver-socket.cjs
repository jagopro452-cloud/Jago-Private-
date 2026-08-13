const { io } = require('socket.io-client');

const driverId = process.argv[2];
const token = process.argv[3];

const socket = io('http://localhost:5000', {
  query: { userId: driverId, userType: 'driver', token },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('[QA-SOCKET] connected', socket.id);
});
socket.on('auth:error', (e) => console.error('[QA-SOCKET] auth error', e));
socket.on('trip:new_request', (data) => console.log('[QA-SOCKET] trip:new_request', JSON.stringify(data)));
socket.on('disconnect', (reason) => console.log('[QA-SOCKET] disconnected', reason));

// Keep alive until parent kills it
process.stdin.resume();
