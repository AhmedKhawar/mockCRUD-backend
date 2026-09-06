import { model, Schema } from "mongoose";

const resourceSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: [true, "Project ID is required"],
    },

    auth: {
      type: Boolean,
      default: false
    },

    name: {
      type: String,
      required: [true, "Resource name is required"],
      lowercase: true,
      trim: true,
    },

    spec: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

// Ensures a user cannot create duplicate resources with the same name inside the same project
resourceSchema.index({ projectId: 1, name: 1 }, { unique: true });

const Resource = model("Resource", resourceSchema);
export default Resource;