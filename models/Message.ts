import mongoose from "../config/db";

export interface IMessage extends mongoose.Document {
  sender: string;
  content: string;
  roomId?: string;
  participants?: string[];
  timestamp: Date;
}

const messageSchema = new mongoose.Schema<IMessage>({
  sender: { type: String, required: true },
  content: { type: String, required: true },
  roomId: { type: String },
  participants: [{ type: String }],
  timestamp: { type: Date, default: Date.now }
});

export const Message = mongoose.model<IMessage>("Message", messageSchema);
