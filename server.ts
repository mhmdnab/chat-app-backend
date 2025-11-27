import dotenv from "dotenv";
dotenv.config();
import express, { Request, Response } from "express";
import { createServer } from "http";
import cors from "cors";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { connectDB } from "./config/db";
import { User } from "./models/User";
import { Room } from "./models/Room";
import { Message, IMessage } from "./models/Message";

const app = express();
const defaultOrigins = ["https://chat-app-frontend-indol-two.vercel.app"];

const allowedOrigins = (
  process.env.CLIENT_ORIGINS ||
  process.env.CLIENT_ORIGIN ||
  defaultOrigins.join(",")
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

console.log("CORS allowed origins:", allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin))
        return callback(null, origin);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

const onlineUsers = new Map<string, Set<string>>(); // username -> socketIds
const roomMembers = new Map<string, Set<string>>(); // roomId -> usernames
const socketUser = new Map<string, string>(); // socketId -> username

const emitRoomUsers = (roomId: string) => {
  const users = Array.from(roomMembers.get(roomId) || []);
  io.to(roomId).emit("room_users", { roomId, users });
};

app.post("/login", async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    let user = await User.findOne({ username });
    if (!user) {
      user = await User.create({ username });
    }

    const sessionId = uuidv4();
    return res.json({ user, sessionId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Login failed" });
  }
});

app.get("/rooms", async (_req: Request, res: Response) => {
  try {
    const rooms = await Room.find().sort({ createdAt: 1 });
    return res.json(rooms);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

app.post("/rooms", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const existing = await Room.findOne({ name });
    if (existing) return res.status(400).json({ error: "Room already exists" });
    const room = await Room.create({ name, members: [] });
    return res.status(201).json(room);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create room" });
  }
});

app.get("/rooms/:id/messages", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const messages = await Message.find({ roomId: id }).sort({ timestamp: 1 });
    return res.json(messages);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.get("/private/:user1/:user2", async (req: Request, res: Response) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      participants: { $all: [user1, user2] },
    }).sort({ timestamp: 1 });
    return res.json(messages);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch direct messages" });
  }
});

io.on("connection", (socket) => {
  const username = socket.handshake.query.username as string | undefined;
  if (username) {
    const sockets = onlineUsers.get(username) || new Set<string>();
    sockets.add(socket.id);
    onlineUsers.set(username, sockets);
    socketUser.set(socket.id, username);
    io.emit("online_users", Array.from(onlineUsers.keys()));
  }

  socket.on(
    "join_room",
    async ({
      roomId,
      username: user,
    }: {
      roomId: string;
      username: string;
    }) => {
      if (!roomId || !user) return;
      socket.join(roomId);

      const members = roomMembers.get(roomId) || new Set<string>();
      members.add(user);
      roomMembers.set(roomId, members);

      await Room.updateOne(
        { _id: roomId, members: { $ne: user } },
        { $push: { members: user } }
      ).catch(() => undefined);

      emitRoomUsers(roomId);
    }
  );

  socket.on(
    "leave_room",
    ({ roomId, username: user }: { roomId: string; username: string }) => {
      socket.leave(roomId);
      const members = roomMembers.get(roomId);
      if (members && members.has(user)) {
        members.delete(user);
        roomMembers.set(roomId, members);
        emitRoomUsers(roomId);
      }
    }
  );

  socket.on(
    "message",
    async ({
      roomId,
      content,
      sender,
    }: {
      roomId: string;
      content: string;
      sender: string;
    }) => {
      if (!roomId || !content || !sender) return;
      const message = await Message.create({
        sender,
        content,
        roomId,
        timestamp: new Date(),
      });
      io.to(roomId).emit("message", message);
    }
  );

  socket.on(
    "typing",
    ({
      roomId,
      sender,
      to,
      isPrivate,
    }: {
      roomId?: string;
      sender: string;
      to?: string;
      isPrivate?: boolean;
    }) => {
      if (isPrivate && to) {
        const targets = onlineUsers.get(to);
        targets?.forEach((sid) =>
          io.to(sid).emit("typing", { sender, isPrivate, to })
        );
      } else if (roomId) {
        socket.to(roomId).emit("typing", { roomId, sender });
      }
    }
  );

  socket.on(
    "stop_typing",
    ({
      roomId,
      sender,
      to,
      isPrivate,
    }: {
      roomId?: string;
      sender: string;
      to?: string;
      isPrivate?: boolean;
    }) => {
      if (isPrivate && to) {
        const targets = onlineUsers.get(to);
        targets?.forEach((sid) =>
          io.to(sid).emit("stop_typing", { sender, isPrivate, to })
        );
      } else if (roomId) {
        socket.to(roomId).emit("stop_typing", { roomId, sender });
      }
    }
  );

  socket.on(
    "private_message",
    async ({
      to,
      sender,
      content,
    }: {
      to: string;
      sender: string;
      content: string;
    }) => {
      if (!to || !sender || !content) return;
      const participants = [sender, to];
      const message: IMessage = await Message.create({
        sender,
        content,
        participants,
        timestamp: new Date(),
      });

      const targetSockets = onlineUsers.get(to);
      targetSockets?.forEach((sid) =>
        io.to(sid).emit("private_message", message)
      );
      socket.emit("private_message", message);
    }
  );

  socket.on("disconnect", () => {
    const user = socketUser.get(socket.id);
    if (user) {
      const sockets = onlineUsers.get(user);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(user);
        } else {
          onlineUsers.set(user, sockets);
        }
      }
      socketUser.delete(socket.id);
      io.emit("online_users", Array.from(onlineUsers.keys()));

      roomMembers.forEach((members, roomId) => {
        if (members.delete(user)) {
          roomMembers.set(roomId, members);
          emitRoomUsers(roomId);
        }
      });
    }
  });
});

const PORT = process.env.PORT || 4000;

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
});
