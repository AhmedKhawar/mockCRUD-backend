import express from "express"
import { createResource, getProjectResources, removeResource, toggleAuth } from "../controller/resourceController.js"
import { auth } from "../middleware/auth.js"
import { resourceLimit } from "../middleware/rateLimit.js"


export const resourceRouter = express.Router()

resourceRouter.post("/resource",resourceLimit,auth,createResource)
resourceRouter.delete("/resource/:resourceId", auth, removeResource)
resourceRouter.get("/resource", auth, getProjectResources)
resourceRouter.patch("/resource/:resourceId/enableAuth", auth, toggleAuth)
