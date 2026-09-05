import Project from "../models/project.js";
import Resource from "../models/resource.js";

// GET /api/projects/:projectId/resources
export const getProjectResources = async (req, res) => {
  try {
    const { projectId } = req.query;
    const userId = req.user.id;

    // 1. Verify project exists and belongs to this user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
      });
    }

    // 2. Query resource records strictly based on this projectId
    const resources = await Resource.find({ projectId: project._id }).sort({
      createdAt: -1,
    });

    const host = req.get("host");
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}/m/${project.slug}`;

    return res.status(200).json({
      success: true,
      project: {
        id: project._id,
        name: project.name,
        slug: project.slug,
      },
      count: resources.length,
      resources: resources.map((r) => ({
        id: r._id,
        name: r.name,
        mockUrl: `${baseUrl}/${r.name}`,
        endpoints: r.spec?.endpoints || [],
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};