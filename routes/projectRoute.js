import express from "express"
import { auth } from "../middleware/auth.js"
import { createProject, getUserProjects, removeProject } from "../controller/projectController.js"

export const projectRouter = express.Router()

projectRouter.post("/project", auth, createProject)
projectRouter.get("/project", auth, getUserProjects)
projectRouter.delete("/project/:projectId", auth, removeProject)
