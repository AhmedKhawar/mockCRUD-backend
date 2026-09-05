import {model, Schema} from "mongoose"

const userSchema = new Schema({
    email:{
        type: String, 
        unique: true,
        required: true
    },

    password:{
        type: String,
        required: true,
        minLength: [8, "Password should be atleast 8 characters long"]
    }

}, {timestamps: true})

const User = model("User", userSchema);
export default User;