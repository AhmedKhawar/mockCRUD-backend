import express from "express"
import { userRouter } from "./routes/userRoute.js"
import { projectRouter } from "./routes/projectRoute.js"
import { apiRouter } from "./routes/mock_data_Route.js"
import { userOfferingRouter } from "./routes/userOfferingRoute.js"
import mongoose from "mongoose"
import cors from "cors"
import { resourceRouter } from "./routes/resourceRoute.js"
import 'dotenv/config'


const app = express()
app.use(express.json())


app.use(cors({
  origin: "https://mock-crud-blond.vercel.app/",
  credentials: true
}));



let isConnected = false;



const connectDB = async () => {
  if (isConnected) {
    return;
  }
  try {
    const db = await mongoose.connect(process.env.URL);
    isConnected = db.connections[0].readyState;
    console.log("Connection established with Mongo DB");
  } catch (err) {
    console.log("Error encountered while establishing connection with DB " + err);
  }
};

app.use(async (req, res, next) => {
  await connectDB();
  next();
});


app.use("/api", userRouter)
app.use("/api", projectRouter)
app.use("/api", resourceRouter)
app.use("/m", apiRouter)
app.use("/", userOfferingRouter)

app.get("/", (req, res) => {
  return res.json({
    "msg": "Hello from Server"
  })
})

// Listen locally only (Vercel handles this in production)
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// Export the app instance for Vercel
export default app;