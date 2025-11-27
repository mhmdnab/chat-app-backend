import mongoose from "../config/db";

export interface IRoom extends mongoose.Document {
  name: string;
  members: string[];
  createdAt: Date;
}

const roomSchema = new mongoose.Schema<IRoom>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    members: [{ type: String }]
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Room = mongoose.model<IRoom>("Room", roomSchema);
