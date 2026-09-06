import UserV2 from "../models/userOffering.js";
import Project from "../models/project.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const validateSlug = async (slug) => {
    const project = await Project.findOne({ slug });
    return project;
};

export const signUp = async (req, res) => {
    try {
        const { slug } = req.params;

        const project = await validateSlug(slug);
        if (!project) {
            return res.status(404).json({
                success: false,
                message: `No project found with slug '${slug}'`,
            });
        }

        const { email, password, name, dob } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({
                success: false,
                message: "Email, password, and name are required",
            });
        }

        const existingUser = await UserV2.findOne({ email, projectId: project._id });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists in this project",
            });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await UserV2.create({
            projectId: project._id,
            email,
            password: hashedPassword,
            name,
            dob,
        });

        return res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                dob: user.dob,
            },
        });
    } catch (error) {
        // Catch race-condition collisions caught by the database compound index
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: "User already exists in this project",
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

export const login = async (req, res) => {
    try {
        const { slug } = req.params;

        const project = await validateSlug(slug);
        if (!project) {
            return res.status(404).json({
                success: false,
                message: `No project found with slug '${slug}'`,
            });
        }

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required",
            });
        }

        const user = await UserV2.findOne({ email, projectId: project._id });
        if (!user) {
            return res.status(400).json({
                success: false,
                message: "Invalid credentials",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Invalid credentials",
            });
        }

        const token = jwt.sign(
            { id: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES || "7d" }
        );

        return res.status(200).json({
            success: true,
            message: "Login successful",
            token,
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

export const logout = async (req, res) => {
    try {
        const { slug } = req.params;

        const project = await validateSlug(slug);
        if (!project) {
            return res.status(404).json({
                success: false,
                message: `No project found with slug '${slug}'`,
            });
        }

        return res.status(200).json({
            success: true,
            message: "Logged out successfully",
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};
