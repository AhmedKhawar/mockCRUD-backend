import MockData from "../models/mock_data.js";
import Project from "../models/project.js";
import Resource from "../models/resource.js";
import { validatePrompt } from "../utils/LLMService.js";

export const createResource = async (req, res) => {
  try {
    const { projectId, description } = req.body;

    // Validate project ID
    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
    }

    // Validate description
    if (!description || !description.trim()) {
      return res.status(400).json({
        success: false,
        message: "Prompt cannot be empty",
      });
    }

    // Verify project exists and belongs to authenticated user
    const project = await Project.findOne({
      _id: projectId,
      userId: req.user.id,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
      });
    }

    // Validate the user's prompt
    const validation = await validatePrompt(description);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: "Invalid API endpoint description",
      });
    }

    // Generate specs for all resources
    const specs = await Promise.all(
      validation.resources.map((item) =>
        getSpec(
          item.resource,
          item.requiredFields,
          item.properties,
          description
        )
      )
    );

    // Validate that every generated spec has a resource name
    const invalidSpec = specs.find(
      (item) =>
        !item.resource ||
        item.resource.toLowerCase().trim() === ""
    );

    if (invalidSpec) {
      return res.status(422).json({
        success: false,
        message: "Failed to resolve a valid resource name from prompt",
      });
    }

    // Normalize resource names
    const resourceNames = specs.map(
      (item) => item.resource.toLowerCase().trim()
    );

    // Check for duplicate resource names within this request
    const uniqueNames = new Set(resourceNames);

    if (uniqueNames.size !== resourceNames.length) {
      return res.status(409).json({
        success: false,
        message: "Duplicate resource names were generated",
      });
    }

    // Check if any resource already exists in this project
    const existingResources = await Resource.find({
      projectId: project._id,
      name: { $in: resourceNames },
    }).select("name");

    if (existingResources.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Resource(s) already exist: ${existingResources
          .map((item) => item.name)
          .join(", ")}`,
      });
    }

    // Create all resources
    const newResources = await Resource.insertMany(
      specs.map((spec, index) => ({
        projectId: project._id,
        name: resourceNames[index],
        spec,
      }))
    );

    // Return created resources
    return res.status(201).json({
      success: true,
      message: "Resources created successfully",
      resources: newResources.map((resource) => ({
        id: resource._id,
        projectId: resource.projectId,
        name: resource.name,
        spec: resource.spec,
      })),
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