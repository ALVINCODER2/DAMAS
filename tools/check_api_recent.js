const http = require("http");

const opts = {
  hostname: "localhost",
  port: process.env.PORT || 3001,
  path: "/api/recent-matches?limit=5",
  method: "GET",
  headers: { "Content-Type": "application/json" },
};

const req = http.request(opts, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    try {
      console.log("Status:", res.statusCode);
      console.log("Body:", JSON.parse(data));
    } catch (e) {
      console.error("Failed to parse response:", e && e.message);
      console.log("Raw:", data);
    }
  });
});
req.on("error", (e) => console.error("Request error:", e && e.message));
req.end();
