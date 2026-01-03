const io = require("socket.io-client");

const url = process.env.TEST_SERVER_URL || "http://localhost:3001";
console.log("Connecting to", url);
const socket = io(url, { transports: ["websocket"], forceNew: true });

socket.on("connect", () => {
  console.log("connected as", socket.id);
});

socket.on("matchRecorded", (m) => {
  console.log("matchRecorded received:", m);
});

socket.on("connect_error", (e) => {
  console.error("connect_error", e && e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log("listener running, will exit in 60s");
}, 1000);
