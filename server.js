const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.IMAGE_API_KEY;

const API_BASE = "https://image.gen.hafiz.live";

function send(res, status, data, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });

  res.end(data);
}

function ratio(value) {
  const allowed = ["1:1", "16:9", "9:16", "4:3"];

  return allowed.includes(value)
    ? value
    : "1:1";
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,

    headers: {
      ...(options.headers || {}),
      "Content-Type": "application/json",
      "X-API-Key": API_KEY
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Image API returned an invalid response."
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Image API error: ${response.status}`
    );
  }

  return data;
}

async function generate(prompt, aspectRatio) {
  return await apiRequest(
    `${API_BASE}/api/generate?format=json`,
    {
      method: "POST",

      body: JSON.stringify({
        prompt: prompt,
        ratio_id: ratio(aspectRatio)
      })
    }
  );
}

async function pollGeneration(generationId) {

  for (let attempt = 0; attempt < 12; attempt++) {

    await new Promise(resolve =>
      setTimeout(resolve, 7000)
    );

    const data = await apiRequest(
      `${API_BASE}/api/generate/status/${generationId}`,
      {
        method: "GET"
      }
    );

    if (
      data.status === "completed" ||
      data.status === "complete" ||
      data.status === "success"
    ) {
      return data;
    }

    if (
      data.status === "failed" ||
      data.status === "error"
    ) {
      throw new Error(
        data.error ||
        data.message ||
        "Image generation failed."
      );
    }
  }

  throw new Error(
    "Image generation timed out. Please try again."
  );
}

function findImage(data) {

  return (
    data.previewUrl ||
    data.downloadUrl ||
    data.imageUrl ||
    data.image ||
    data.output ||
    data.url ||
    null
  );
}

const server = http.createServer((req, res) => {

  // CORS
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

  // Website
  if (
    req.method === "GET" &&
    (req.url === "/" || req.url === "/index.html")
  ) {

    try {

      const file = fs.readFileSync(
        path.join(__dirname, "index.html")
      );

      return send(
        res,
        200,
        file,
        "text/html; charset=utf-8"
      );

    } catch (error) {

      return send(
        res,
        500,
        JSON.stringify({
          error: "index.html not found."
        })
      );
    }
  }

  // Generate image
  if (
    req.method === "POST" &&
    (
      req.url === "/.netlify/functions/generate-image" ||
      req.url === "/api/generate-image"
    )
  ) {

    let body = "";

    req.on("data", chunk => {

      body += chunk;

      if (body.length > 35 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {

      try {

        if (!API_KEY) {

          return send(
            res,
            500,
            JSON.stringify({
              error:
                "IMAGE_API_KEY is missing in Render Environment."
            })
          );
        }

        let data;

        try {
          data = JSON.parse(body || "{}");
        } catch {
          return send(
            res,
            400,
            JSON.stringify({
              error: "Invalid JSON request."
            })
          );
        }

        const prompt =
          String(data.prompt || "").trim();

        const aspectRatio =
          data.aspectRatio || "1:1";

        if (!prompt) {

          return send(
            res,
            400,
            JSON.stringify({
              error: "Prompt is required."
            })
          );
        }

        // Start generation
        let result = await generate(
          prompt,
          aspectRatio
        );

        // Image immediately available
        let image = findImage(result);

        if (image) {

          return send(
            res,
            200,
            JSON.stringify({
              image: image,
              download:
                result.downloadUrl || image,
              usage:
                result.usage || null
            })
          );
        }

        // Async generation
        const generationId =
          result.generationId ||
          result.id;

        if (
          result.status === "processing" ||
          result.status === "pending" ||
          result.status === "queued" ||
          generationId
        ) {

          if (!generationId) {
            throw new Error(
              "Generation started but no generation ID was returned."
            );
          }

          result =
            await pollGeneration(
              generationId
            );

          image = findImage(result);

          if (!image) {
            throw new Error(
              "Image URL was not returned."
            );
          }

          return send(
            res,
            200,
            JSON.stringify({
              image: image,
              download:
                result.downloadUrl || image,
              usage:
                result.usage || null
            })
          );
        }

        throw new Error(
          "Image URL was not returned by the API."
        );

      } catch (error) {

        console.error(
          "IMAGE GENERATION ERROR:",
          error
        );

        return send(
          res,
          500,
          JSON.stringify({
            error:
              error.message ||
              "Image generation failed."
          })
        );
      }
    });

    return;
  }

  // 404
  return send(
    res,
    404,
    JSON.stringify({
      error: "Not found"
    })
  );
});

server.listen(PORT, () => {
  console.log(
    `AI-TC running on port ${PORT}`
  );
});
