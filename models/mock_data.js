import { model, Schema } from "mongoose";

const mockDataSchema = new Schema(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },

    resource: {
      type: String,
      required: [true, "Resource name is required"],
      lowercase: true,
      trim: true,
    },

    data: {
      type: Schema.Types.Mixed,
      required: [true, "Payload data is required"],
    },
  },
  { timestamps: true, strict: false }
);

mockDataSchema.index({ projectId: 1, resource: 1 });

const MockData = model("MockData", mockDataSchema);
export default MockData;