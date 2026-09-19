import { model, Schema } from "mongoose"

const userSchema = new Schema({
    email: {
        type: String,
        unique: true,
        required: true
    },

    isGoogle:{
        type: bool,
        required: false
    }

    password: {
        type: String,
        // removed required: true because google auth wont have password
        minLength: [8, "Password should be atleast 8 characters long"]
    }

}, { timestamps: true })

const User = model("User", userSchema);
export default User;