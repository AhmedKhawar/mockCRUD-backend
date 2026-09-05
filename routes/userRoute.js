import express from "express"
import { login, logout, signUp } from "../controller/userController.js"
import { auth } from "../middleware/auth.js"


export const userRouter = express.Router()


userRouter.post("/signup", signUp)
userRouter.post("/login", login)
userRouter.post("/logout", auth, logout)