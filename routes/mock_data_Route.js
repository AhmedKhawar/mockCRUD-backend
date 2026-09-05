import express from "express"
import { mockAPI } from "../controller/mock_data_Controller.js"


export const apiRouter = express.Router()

apiRouter.all("/:slug/*path", mockAPI)