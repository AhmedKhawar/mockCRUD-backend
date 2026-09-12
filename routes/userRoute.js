import express from "express"
import { login, logout, signUp } from "../controller/userController.js"
import { auth } from "../middleware/auth.js"
import { authLimit } from "../middleware/rateLimit.js"


export const userRouter = express.Router()


userRouter.post("/signup", authLimit,signUp)
userRouter.post("/login",authLimit,  login)
userRouter.post("/logout", auth, logout)