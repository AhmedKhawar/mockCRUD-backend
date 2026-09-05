import Project from "../models/project.js";
import Resource from "../models/resource.js";
import MockData from "../models/mock_data.js";

export const mockAPI = async (req, res) => {
  try {
    const { slug } = req.params;
    const rawPath = req.params.path || req.params[0] || [];

    // Handles Express 5 array output and fallback strings
    const segments = Array.isArray(rawPath)
      ? rawPath
      : String(rawPath).split("/").filter(Boolean);

    const [resourceName, id] = segments;

    // 1. Basic path validation
    if (!resourceName) {
      return res.status(400).json({ error: "Resource path is missing" });
    }

    // 2. Fetch project by slug
    const project = await Project.findOne({ slug });
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // 3. Fetch resource linked to this project
    const resourceDoc = await Resource.findOne({
      projectId: project._id,
      name: resourceName.toLowerCase(),
    });

    if (!resourceDoc) {
      return res.status(404).json({
        error: `Resource '${resourceName}' not found in project '${slug}'`,
      });
    }

    // 4. Verify route and method exist in resource spec
    const targetPath = id ? `/${resourceName}/:id` : `/${resourceName}`;
    const endpointRule = resourceDoc.spec.endpoints.find(
      (ep) => ep.path === targetPath && ep.method === req.method
    );

    if (!endpointRule) {
      return res.status(405).json({
        error: `Method ${req.method} not allowed for '${targetPath}'`,
      });
    }

    const baseQuery = { projectId: project._id, resource: resourceName.toLowerCase() };

    // 5. Route handling (all 5 CRUD actions)
    switch (req.method) {
      case "GET": {
        // Fetch single record
        if (id) {
          const item = await MockData.findOne({ ...baseQuery, _id: id });
          if (!item) return res.status(404).json({ error: "Record not found" });
          return res.status(200).json({ id: item._id, ...item.data });
        }

        // Fetch all records
        const records = await MockData.find(baseQuery);
        return res.status(200).json(records.map((doc) => ({ id: doc._id, ...doc.data })));
      }

      case "POST": {
        const payload = req.body;

        // Check required fields (checks undefined, null, and empty strings)
        const required = endpointRule.requiredFields || [];
        const missingFields = required.filter(
          (field) => payload[field] === undefined || payload[field] === null || payload[field] === ""
        );

        if (missingFields.length > 0) {
          return res.status(422).json({
            error: "Missing required fields",
            missingFields,
          });
        }

        // Save record
        const newRecord = await MockData.create({
          projectId: project._id,
          resource: resourceName.toLowerCase(),
          data: payload,
        });

        return res.status(201).json({ id: newRecord._id, ...newRecord.data });
      }

      case "PUT": {
        if (!id) {
          return res.status(400).json({ error: "Record ID is required for PUT" });
        }

        const payload = req.body;

        // Check required fields for update
        const required = endpointRule.requiredFields || [];
        const missingFields = required.filter(
          (field) => payload[field] === undefined || payload[field] === null || payload[field] === ""
        );

        if (missingFields.length > 0) {
          return res.status(422).json({
            error: "Missing required fields",
            missingFields,
          });
        }

        // Update record
        const updatedRecord = await MockData.findOneAndUpdate(
          { ...baseQuery, _id: id },
          { data: payload },
          { new: true }
        );

        if (!updatedRecord) {
          return res.status(404).json({ error: "Record not found" });
        }

        return res.status(200).json({ id: updatedRecord._id, ...updatedRecord.data });
      }

      case "DELETE": {
        if (!id) {
          return res.status(400).json({ error: "Record ID is required for DELETE" });
        }

        const deletedRecord = await MockData.findOneAndDelete({ ...baseQuery, _id: id });

        if (!deletedRecord) {
          return res.status(404).json({ error: "Record not found" });
        }

        return res.status(200).json({
          message: "Record deleted successfully",
          id: deletedRecord._id,
        });
      }

      default:
        return res.status(405).json({ error: `Method ${req.method} not allowed` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};