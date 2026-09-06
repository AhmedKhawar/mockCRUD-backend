import { customAlphabet } from 'nanoid';
import Project from '../models/project.js';
import Resource from '../models/resource.js';
import MockData from '../models/mock_data.js';
import 'dotenv/config'

// URL-safe lowercase alphabet and numbers
const generateSlug = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);


export const createProject = async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;
    const slug = generateSlug();

    const newProject = await Project.create({
      userId,
      name: name || 'Untitled Project',
      slug,
    });

    return res.status(201).json({
      success: true,
      message: 'Project created successfully',
      project: {
        id: newProject._id,
        name: newProject.name,
        slug: newProject.slug,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const removeProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    // 1. Verify project exists and belongs to the authenticated user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
      });
    }

    // 2. Cascade delete all associated collections concurrently
    await Promise.all([
      MockData.deleteMany({ projectId: project._id }),
      Resource.deleteMany({ projectId: project._id }),
      Project.findByIdAndDelete(project._id),
    ]);

    return res.status(200).json({
      success: true,
      message: `Project '${project.name}' and all its resources were deleted`,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};


export const getUserProjects = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch projects belonging to this authenticated user
    const projects = await Project.find({ userId })
      .select("name slug settings createdAt updatedAt")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: projects.length,
      projects: projects.map((p) => ({
        id: p._id,
        name: p.name,
        slug: p.slug,
        settings: p.settings,
        createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};