const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

// Render Environment Variable
const IMAGE_API_KEY = process.env.IMAGE_API_KEY;

const API_URL =
  "https://image.gen.hafiz.live/api/generate?format=json";

function send(res, status, data, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });

  res.end(data);
}

function convertRatio(aspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return "16:9";

    case "9:16":
      return "9:16";

    case "4:3":
      return "4:3";

    case "1:1":
    default:
      return "1:1";
  }
}

async function generateImage(prompt, aspectRatio) {

  const response = await fetch(API_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "X-API-Key": IMAGE_API_KEY
    },

    body: JSON.stringify({
      prompt: prompt,
      ratio_id: convertRatio(aspectRatio)
    })
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

async function waitForImage(statusUrl) {

  for (let i = 0; i < 20; i++) {

    await new Promise(resolve =>
      setTimeout(resolve, 5000)
    );

    const response = await fetch(statusUrl, {
      headers: {
        "X-API-Key": IMAGE_API_KEY
      }
    });

    const data = await response.json();

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
    "Image generation took too long."
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
        "text/html"
      );

    } catch {

      return send(
        res,
        500,
        JSON.stringify({
          error: "index.html not found."
        })
      );
    }
  }

  // Image generation
  if (
    req.method === "POST" &&
    req.url === "/.netlify/functions/generate-image"
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

        // API key check
        if (!IMAGE_API_KEY) {

          return send(
            res,
            500,
            JSON.stringify({
              error:
                "IMAGE_API_KEY is missing in Render Environment."
            })
          );
        }

        const data = JSON.parse(
          body || "{}"
        );

        const prompt =
          String(data.prompt || "").trim();

        const aspectRatio =
          data.aspectRatio || "1:1";

        if (!prompt) {

          return send(
            res,
            400,
            JSON.stringify({
              error:
                "Prompt is required."
            })
          );
        }

        // Generate image
        const result =
          await generateImage(
            prompt,
            aspectRatio
          );

        // Normal completed response
        if (
          result.previewUrl ||
          result.downloadUrl
        ) {

          return send(
            res,
            200,
            JSON.stringify({
              image:
                result.previewUrl ||
                result.downloadUrl,

              download:
                result.downloadUrl ||
                result.previewUrl,

              usage:
                result.usage || null
            })
          );
        }

        // Async generation
        if (
          result.statusUrl
        ) {

          const finalResult =
            await waitForImage(
              result.statusUrl
            );

          const image =
            finalResult.previewUrl ||
            finalResult.downloadUrl ||
            finalResult.imageUrl ||
            finalResult.image ||
            finalResult.output;

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
                finalResult.downloadUrl ||
                image,

              usage:
                finalResult.usage || null
            })
          );
        }

        // Another possible async format
        if (
          result.generationId
        ) {

          const statusUrl =
            `https://image.gen.hafiz.live/api/generate/status/${result.generationId}`;

          const finalResult =
            await waitForImage(
              statusUrl
            );

          const image =
            finalResult.previewUrl ||
            finalResult.downloadUrl ||
            finalResult.imageUrl ||
            finalResult.image ||
            finalResult.output;

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
                finalResult.downloadUrl ||
                image,

              usage:
                finalResult.usage || null
            })
          );
        }

        throw new Error(
          "Image URL was not returned by the API."
        );

      } catch (error) {

        console.error(error);

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
