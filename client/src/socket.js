import { io } from 'socket.io-client';
import { getToken } from './api';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io({ auth: { token: getToken() }, autoConnect: true });
  }
  return socket;
}

export function closeSocket() {
  socket?.close();
  socket = null;
}
