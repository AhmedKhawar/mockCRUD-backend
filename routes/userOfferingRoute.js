import express from "express"
import { login, logout, signUp } from "../controller/userOfferingController.js"
import { auth } from "../middleware/auth.js"


export const userOfferingRouter = express.Router()


userOfferingRouter.post("/:slug/signup", signUp)
userOfferingRouter.post("/:slug/login", login)
userOfferingRouter.post("/:slug/logout", auth, logout)
