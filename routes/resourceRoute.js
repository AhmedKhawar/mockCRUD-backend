import express from "express"
import { createResource, removeResource } from "../controller/resourceController.js"
import { auth } from "../middleware/auth.js"
import { getProjectResources } from "../utils/getResource.js"


export const resourceRouter = express.Router()

resourceRouter.post("/resource", auth, createResource)
resourceRouter.post("/resource:resourceId", auth, removeResource)
resourceRouter.get("/resource", auth, getProjectResources)