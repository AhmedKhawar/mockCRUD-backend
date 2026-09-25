import MockData from "../models/mock_data.js";
import Project from "../models/project.js";
import Resource from "../models/resource.js";
import { generateUnifiedSchema } from "../utils/LLMService.js";

// ── Build REST spec from a list of properties ──────────────────────────────
const buildSpec = (resourceName, properties) => {
  const name = resourceName.toLowerCase().trim();
  const singular = name.endsWith("s") ? name.slice(0, -1) : name;

  const requiredFields = properties
    .filter((p) => p.required)
    .map((p) => p.fieldName);

  return {
    resource: name,
    endpoints: [
      { method: "GET", path: `/${name}`, description: `Retrieve all ${name}`, properties },
      { method: "GET", path: `/${name}/:id`, description: `Retrieve a single ${singular} by ID`, properties },
      { method: "POST", path: `/${name}`, description: `Create a new ${singular}`, requiredFields, properties },
      { method: "PUT", path: `/${name}/:id`, description: `Update an existing ${singular} by ID`, properties },
      { method: "DELETE", path: `/${name}/:id`, description: `Delete a ${singular} by ID`, properties: [{ fieldName: "id", fieldType: "String" }] },
    ],
  };
};

// ── createResource ────────────────────────────────────────────────────────
export const createResource = async (req, res) => {
  try {
    const { projectId, resources } = req.body;

    if (!projectId) return res.status(400).json({ success: false, message: "Project ID is required" });
    if (!Array.isArray(resources) || resources.length === 0) return res.status(400).json({ success: false, message: "At least one resource is required" });

    const project = await Project.findOne({ _id: projectId, userId: req.user.id });
    if (!project) return res.status(404).json({ success: false, message: "Project not found or unauthorized" });

    const names = resources.map((r) => r.name?.toLowerCase().trim()).filter(Boolean);
    if (names.length !== resources.length) return res.status(400).json({ success: false, message: "All resources must have a name" });

    const existing = await Resource.find({ projectId: project._id, name: { $in: names } }).select("name");
    if (existing.length > 0) return res.status(409).json({ success: false, message: `Already exist in this project: ${existing.map((e) => e.name).join(", ")}` });

    // Build the precise batch for the unified LLM call
    const resourcesBatch = resources.map(r => ({
      name: r.name,
      link: r.link === true,
      inferFields: r.inferFields === true,
      inferFieldCount: r.inferFields ? Math.min(Math.max(parseInt(r.inferFieldCount) || 4, 1), 8) : undefined,
      fields: !r.inferFields ? (r.fields || []).map(f => ({
        name: f.name?.trim(),
        type: f.type || "String",
        required: f.required === true
      })).filter(f => f.name) : undefined
    }));

    // ALL-IN-ONE Gemini Call (Validation + Inference + Smart Relational Linking)
    const schemaResult = await generateUnifiedSchema(resourcesBatch);

    // Granular Validation Error Propagated to Frontend
    if (!schemaResult.valid) {
      return res.status(400).json({
        success: false,
        message: schemaResult.invalidReason || "Invalid resource definitions."
      });
    }

    // Map auth preferences back to the returned schema resources
    const authMap = {};
    for (const reqR of resources) authMap[reqR.name.toLowerCase().trim()] = reqR.auth === true;

    // Persist resources
    const newResources = await Resource.insertMany(
      schemaResult.resources.map((r) => ({
        projectId: project._id,
        name: r.name,
        auth: authMap[r.name] || false,
        aiAddedFields: r.aiAddedFields || [],
        spec: buildSpec(r.name, r.properties),
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
    console.error("[createResource] error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── removeResource ────────────────────────────────────────────────────────
export const removeResource = async (req, res) => {
  try {
    const { resourceId } = req.params;
    const userId = req.user.id;

    const resource = await Resource.findById(resourceId);
    if (!resource) {
      return res.status(404).json({ success: false, message: "Resource does not exist" });
    }

    const project = await Project.findOne({ _id: resource.projectId, userId });
    if (!project) {
      return res.status(403).json({ success: false, message: "Unauthorized to delete this resource" });
    }

    await Resource.findByIdAndDelete(resource._id);

    const deleteResult = await MockData.deleteMany({
      projectId: resource.projectId,
      resource: resource.name.toLowerCase(),
    });

    return res.status(200).json({
      success: true,
      message: `Resource '${resource.name}' and its mock data removed`,
      deletedRecordsCount: deleteResult.deletedCount,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || "Delete failed" });
  }
};

// ── getProjectResources ───────────────────────────────────────────────────
export const getProjectResources = async (req, res) => {
  try {
    const { projectId } = req.query;
    const userId = req.user.id;

    const project = await Project.findOne({ _id: projectId, userId });
    if (!project) {
      return res.status(404).json({ success: false, message: "Project not found or unauthorized" });
    }

    const resources = await Resource.find({ projectId: project._id }).sort({ createdAt: -1 });

    const host = req.get("host");
    const baseUrl = `${req.protocol}://${host}/m/${project.slug}`;

    return res.status(200).json({
      success: true,
      project: { id: project._id, name: project.name, slug: project.slug },
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
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ── toggleAuth ────────────────────────────────────────────────────────────
export const toggleAuth = async (req, res) => {
  try {
    const { resourceId } = req.params;
    const userId = req.user.id;

    const resource = await Resource.findById(resourceId);
    if (!resource) {
      return res.status(404).json({ success: false, message: "Resource not found" });
    }

    const project = await Project.findOne({ _id: resource.projectId, userId });
    if (!project) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    resource.auth = !resource.auth;
    await resource.save();

    return res.status(200).json({
      success: true,
      message: `Auth ${resource.auth ? "enabled" : "disabled"} for '${resource.name}'`,
      auth: resource.auth,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
