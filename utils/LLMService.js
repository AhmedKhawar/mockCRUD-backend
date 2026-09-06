import "dotenv/config";

// Robust JSON extraction helper
const extractJSON = (text) => {
  if (!text) throw new Error("Empty response received from model");

  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    throw new Error(
      `Model output did not contain a valid JSON object. Raw: "${text}"`
    );
  }

  const jsonSubstring = cleaned.substring(firstBrace, lastBrace + 1);

  return JSON.parse(jsonSubstring);
};


export const getSpec = async (
  resource,
  requiredFields,
  properties,
  description
) => {

  const systemPrompt = `You are a strict REST API architect.

Generate REST API endpoints for the resource provided by the user.

The resource name, required fields, and properties have already been determined.
DO NOT change, add, remove, or rename any fields or properties.

Return valid JSON matching this exact structure:

{
  "resource": "lowercase_plural_name",
  "endpoints": [
    {
      "method": "GET",
      "path": "/resource",
      "description": "Retrieve all resources",
      "properties": [
        {
          "fieldName": "field1",
          "fieldType": "string"
        }
      ]
    }
  ]
}

Rules:
- Output valid raw JSON only.
- Do NOT output preamble, explanations, or safety notes.
- The "resource" value must be exactly the resource provided.
- The properties must be exactly the properties provided.
- The requiredFields must be exactly the requiredFields provided.
- Generate the standard REST endpoints:
  1. GET /resource
  2. GET /resource/:id
  3. POST /resource
  4. PUT /resource/:id
  5. DELETE /resource/:id
- POST and PUT endpoints must contain the provided requiredFields.
- GET endpoints should contain the provided properties.
- DELETE should contain only the id property.
- Do not create an "id" field in the POST, PUT, or GET resource properties.
- The final JSON structure must remain exactly:
  resource + endpoints.
`;


  const userPrompt = `
Description:
"${description}"

Resource:
${resource}

Required fields:
${JSON.stringify(requiredFields)}

Properties:
${JSON.stringify(properties)}
`;


  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8000",
        "X-Title": "MockAPI Generator",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        response_format: {
          type: "json_object",
        },
        temperature: 0.1,
      }),
    }
  );


  if (!response.ok) {
    const errorData = await response.text();

    throw new Error(
      `OpenRouter API error (${response.status}): ${errorData}`
    );
  }


  const data = await response.json();

  const rawText =
    data.choices?.[0]?.message?.content?.trim();


  const parsed = extractJSON(rawText);


  // Keep the resource exactly as provided
  const resourceName = resource.toLowerCase().trim();


  // Keep the provided properties exactly as they are
  const endpointProperties = properties;


  // Construct the same 5 endpoints
  const endpoints = [
    {
      method: "GET",
      path: `/${resourceName}`,
      description: `Retrieve all ${resourceName}`,
      properties: endpointProperties,
    },

    {
      method: "GET",
      path: `/${resourceName}/:id`,
      description: `Retrieve a single ${resourceName.slice(0, -1) || resourceName
        } by ID`,
      properties: endpointProperties,
    },

    {
      method: "POST",
      path: `/${resourceName}`,
      description: `Create a new ${resourceName.slice(0, -1) || resourceName
        }`,
      requiredFields,
      properties: endpointProperties,
    },

    {
      method: "PUT",
      path: `/${resourceName}/:id`,
      description: `Update an existing ${resourceName.slice(0, -1) || resourceName
        } by ID`,
      requiredFields,
      properties: endpointProperties,
    },

    {
      method: "DELETE",
      path: `/${resourceName}/:id`,
      description: `Delete a ${resourceName.slice(0, -1) || resourceName
        } by ID`,
      properties: [
        {
          fieldName: "id",
          fieldType: "string",
        },
      ],
    },
  ];


  return {
    resource: resourceName,
    endpoints,
  };
};