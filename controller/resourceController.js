import MockData from "../models/mock_data.js";
import Project from "../models/project.js";
import Resource from "../models/resource.js";
import { validatePrompt } from "../utils/LLMService.js";

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
        // requiredFields omitted so updates are flexible
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
    const body = req.body;
    const projectId = body.projectId;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
    }

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

    // Build a map of resourceName (lowercase) → auth so we can stamp each
    // saved document with the correct auth flag from the frontend payload.
    // Custom mode: read from body.resources[]; Infer mode: default false.
    const authMap = {};
    if (body.mode === "custom" && Array.isArray(body.resources)) {
      for (const r of body.resources) {
        if (r.name) {
          authMap[r.name.toLowerCase().trim()] = r.auth === true;
        }
      }
    }

    // Pass the full body (minus projectId) to the LLM service
    const validation = await validatePrompt(body);

    if (!validation.valid || validation.resources.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid entity definitions or resource names.",
      });
    }

    // Build REST specifications
    const specs = validation.resources.map((item) =>
      buildSpec(item.resource, item.requiredFields, item.properties)
    );

    const resourceNames = specs.map((s) => s.resource);

    // Collision check inside project
    const existing = await Resource.find({
      projectId: project._id,
      name: { $in: resourceNames },
    }).select("name");

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Resource(s) already exist: ${existing.map((e) => e.name).join(", ")}`,
      });
    }

    // Build aiAddedFields map from LLM validation result
    const aiAddedMap = {};
    for (const item of validation.resources) {
      aiAddedMap[item.resource] = item.aiAddedFields || [];
    }

    // Persist new resources — stamp auth from the authMap built above
    const newResources = await Resource.insertMany(
      specs.map((spec) => ({
        projectId: project._id,
        name: spec.resource,
        auth: authMap[spec.resource] ?? false,
        aiAddedFields: aiAddedMap[spec.resource] || [],
        spec,
      }))
    );

    return res.status(201).json({
      success: true,
      message: "Resources created successfully",
      resources: newResources.map((r) => ({
        id: r._id,
        projectId: r.projectId,
        name: r.name,
        auth: r.auth,
        aiAddedFields: r.aiAddedFields || [],
        spec: r.spec,
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
