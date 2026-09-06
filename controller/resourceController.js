import MockData from "../models/mock_data.js";
import Project from "../models/project.js";
import Resource from "../models/resource.js";
import { getSpec } from "../utils/LLMService.js";
import { validatePrompt } from "../utils/LLMService2.js";

export const createResource = async (req, res) => {
  try {
    const { projectId, description } = req.body;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
    }

    if (!description || !description.trim()) {
      return res.status(400).json({
        success: false,
        message: "Prompt cannot be empty",
      });
    }

    // Verify project exists and belongs to the authenticated user
    const project = await Project.findOne({ _id: projectId, userId: req.user.id });
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
      });
    }

    const res = await validatePrompt(description)
    console.log(res)
    // Generate spec using your gemini helper
    const spec = await getSpec(description);

    const resourceName = (spec.resource || spec.name || "").toLowerCase().trim();
    if (!resourceName) {
      return res.status(422).json({
        success: false,
        message: "Failed to resolve a valid resource name from prompt",
      });
    }

    // Check if resource already exists in this project
    const existingResource = await Resource.findOne({
      projectId: project._id,
      name: resourceName,
    });

    if (existingResource) {
      return res.status(409).json({
        success: false,
        message: `Resource '${resourceName}' already exists in this project`,
      });
    }

    // Create the resource record linked by projectId
    const newResource = await Resource.create({
      projectId: project._id,
      name: resourceName,
      spec,
    });

    return res.status(201).json({
      success: true,
      message: "Resource created successfully",
      resource: {
        id: newResource._id,
        projectId: newResource.projectId,
        name: newResource.name,
        spec: newResource.spec,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const removeResource = async (req, res) => {
  try {
    const { resourceId } = req.params; // Recommended: pass via URL param /api/resources/:resourceId
    const userId = req.user.id;

    // 1. Fetch resource
    const resource = await Resource.findById(resourceId);
    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Resource does not exist",
      });
    }

    // 2. Security check: verify this resource's project belongs to the authenticated user
    const project = await Project.findOne({
      _id: resource.projectId,
      userId,
    });

    if (!project) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to delete this resource",
      });
    }

    // 3. Delete the resource document
    await Resource.findByIdAndDelete(resource._id);

    // 4. Cascade delete all mock records tied to this project and resource
    const deleteResult = await MockData.deleteMany({
      projectId: resource.projectId,
      resource: resource.name.toLowerCase(),
    });

    return res.status(200).json({
      success: true,
      message: `Resource '${resource.name}' and its mock data were removed successfully`,
      deletedRecordsCount: deleteResult.deletedCount,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "An error occurred while deleting the resource",
    });
  }
};