import { model, Schema } from "mongoose";

const projectSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    name: {
      type: String,
      required: [true, "Project name is required"],
      trim: true,
    },

    slug: {
      type: String,
      unique: true,
      required: [true, "Project slug is required"],
      lowercase: true,
      trim: true,
    },

    settings: {
      simulatedLatencyMs: {
        type: Number,
        default: 0,
      },
      failureRate: {
        type: Number,
        default: 0,
      },
      apiKey: {
        type: String,
        default: null,
      },
    },
  },
  { timestamps: true }
);

const Project = model("Project", projectSchema);
export default Project;