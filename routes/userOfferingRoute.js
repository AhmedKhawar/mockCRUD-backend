import express from "express"
import { login, logout, signUp } from "../controller/userOfferingController.js"
import { auth } from "../middleware/auth.js"


export const userOfferingRouter = express.Router()


userOfferingRouter.post("/:slug/auth/signup", signUp)
userOfferingRouter.post("/:slug/auth/login", login)
userOfferingRouter.post("/:slug/auth/logout", auth, logout)
