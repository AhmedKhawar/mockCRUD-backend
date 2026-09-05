import Project from "../models/project.js";

// GET /api/projects
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