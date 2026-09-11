import MockData from "../models/mock_data.js";
import Project from "../models/project.js";
import Resource from "../models/resource.js";
import { validatePrompt } from "../utils/LLMService.js";

// Builds a standard 5-endpoint REST spec from validated resource data
const buildSpec = (resource, requiredFields, properties) => {
  const resourceName = resource.toLowerCase().trim();
  const singular = resourceName.endsWith("s")
    ? resourceName.slice(0, -1)
    : resourceName;

  return {
    resource: resourceName,
    endpoints: [
      {
        method: "GET",
        path: `/${resourceName}`,
        description: `Retrieve all ${resourceName}`,
        properties,
      },
      {
        method: "GET",
        path: `/${resourceName}/:id`,
        description: `Retrieve a single ${singular} by ID`,
        properties,
      },
      {
        method: "POST",
        path: `/${resourceName}`,
        description: `Create a new ${singular}`,
        requiredFields,
        properties,
      },
      {
        method: "PUT",
        path: `/${resourceName}/:id`,
        description: `Update an existing ${singular} by ID`,
        requiredFields,
        properties,
      },
      {
        method: "DELETE",
        path: `/${resourceName}/:id`,
        description: `Delete a ${singular} by ID`,
        properties: [{ fieldName: "id", fieldType: "string" }],
      },
    ],
  };
};

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

    // LLM flagged the prompt as too vague / ambiguous
    if (validation.ambiguous) {
      return res.status(422).json({
        success: false,
        message:
          "Not enough detail provided. Please describe the data you want to model more specifically (e.g. 'create a student entity with name, email, and grade').",
      });
    }

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: "Invalid prompt. Please describe a software data entity or API resource (e.g. 'create a product with name, price, and stock').",
      });
    }

    // Build specs locally — no extra API call needed
    const specs = validation.resources.map((item) =>
      buildSpec(item.resource, item.requiredFields, item.properties)
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

export const getProjectResources = async (req, res) => {
  try {
    const { projectId } = req.query;
    const userId = req.user.id;

    // Verify project exists and belongs to this user
    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
      });
    }

    // Fetch all resources for this project
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
        auth: r.auth,
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

export const toggleAuth = async (req, res) => {
  try {
    const { resourceId } = req.params;
    const userId = req.user.id;

    // Fetch resource
    const resource = await Resource.findById(resourceId);
    if (!resource) {
      return res.status(404).json({
        success: false,
        message: "Resource not found",
      });
    }

    // Security: verify resource belongs to the authenticated user's project
    const project = await Project.findOne({
      _id: resource.projectId,
      userId,
    });
    if (!project) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // Flip the auth flag
    resource.auth = !resource.auth;
    await resource.save();

    return res.status(200).json({
      success: true,
      message: `Auth ${resource.auth ? 'enabled' : 'disabled'} for '${resource.name}'`,
      auth: resource.auth,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
