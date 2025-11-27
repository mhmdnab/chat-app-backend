import mongoose from "../config/db";

export interface IUser extends mongoose.Document {
  username: string;
  createdAt: Date;
}

const userSchema = new mongoose.Schema<IUser>(
  {
    username: { type: String, required: true, unique: true, trim: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const User = mongoose.model<IUser>("User", userSchema);
