import { model, Schema } from "mongoose";

const userV2Schema = new Schema(
    {
        projectId: {
            type: Schema.Types.ObjectId,
            ref: "Project",
            required: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true, // Recommended: ensures case-insensitive uniqueness
            trim: true,
        },
        password: {
            type: String,
            required: true,
            minLength: [8, "Password should be atleast 8 characters long"],
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        dob: {
            type: Date,
            required: false,
        },
    },
    { timestamps: true }
);

// Enforces email uniqueness SCOPED to each project:
userV2Schema.index({ projectId: 1, email: 1 }, { unique: true });

const UserV2 = model("UserV2", userV2Schema);
export default UserV2;