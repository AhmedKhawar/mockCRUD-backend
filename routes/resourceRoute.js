import express from "express"
import { createResource, getProjectResources, removeResource } from "../controller/resourceController.js"
import { auth } from "../middleware/auth.js"



export const resourceRouter = express.Router()

resourceRouter.post("/resource", auth, createResource)
resourceRouter.delete("/resource/:resourceId", auth, removeResource)
resourceRouter.get("/resource", auth, getProjectResources)