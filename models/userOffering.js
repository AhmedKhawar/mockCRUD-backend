import { model, Schema } from "mongoose"

const userV2Schema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    email: {
        type: String,
        required: true
    },

    password: {
        type: String,
        required: true,
        minLength: [8, "Password should be atleast 8 characters long"]
    },

    name: {
        type: String,
        required: true,
        trim: true
    },

    dob: {
        type: Date,
        required: false
    }

}, { timestamps: true })

const UserV2 = model("UserV2", userV2Schema);
export default UserV2;
