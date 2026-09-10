import jwt from "jsonwebtoken";
import User from "../models/user.js";

export const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "No token, unauthorized" });
    }

    const data = jwt.verify(token, process.env.JWT_SECRET);

    // Verify that the user still exists in the database
    const userExists = await User.exists({ _id: data.id });
    if (!userExists) {
      return res.status(401).json({ message: "User holding this token no longer exists" });
    }

    req.user = data;

    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
