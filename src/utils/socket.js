module.exports = {
  init: (server) => {
    if (io) {
      console.warn("Socket.io already initialized");
      return io;
    }
    io = socketIo(server, {
      cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true,
      },
    });
    io.on("connection", (socket) => {
      if (socket.handshake.query.role === "admin") {
        socket.join("admin");
        console.log("Admin connected to Socket.io");
      }
    });
    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error("Socket.io not initialized. Call init first.");
    }
    return io;
  },
};