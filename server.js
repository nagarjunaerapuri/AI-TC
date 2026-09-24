const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Gemini image generation model
const MODEL = "gemini-3.1-flash-image";

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });

  res.end(JSON.stringify(data));
}

function getAspectRatio(ratio) {
  const allowed = [
    "1:1",
    "16:9",
    "9:16",
    "4:5",
    "3:2",
    "2:3",
    "4:3",
    "21:9"
  ];

  return allowed.includes(ratio) ? ratio : "1:1";
}

function cleanBase64(value) {
  if (!value) return null;

  if (value.includes(",")) {
    return value.split(",")[1];
  }

  return value;
}

async function generateImage(body) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is missing. Add it in Render Environment Variables."
    );
  }

  const prompt = String(body.prompt || "").trim();

  if (!prompt) {
    throw new Error("Please enter a prompt.");
  }

  const aspectRatio = getAspectRatio(body.aspectRatio);

  const parts = [];

  // Main prompt
  parts.push({
    text: prompt
  });

  // Reference image support
  if (body.referenceImage) {
    const base64 = cleanBase64(body.referenceImage);

    if (base64) {
      let mimeType = "image/jpeg";

      if (String(body.referenceImage).startsWith("data:image/png")) {
        mimeType = "image/png";
      } else if (
        String(body.referenceImage).startsWith("data:image/webp")
      ) {
        mimeType = "image/webp";
      } else if (
        String(body.referenceImage).startsWith("data:image/jpeg")
      ) {
        mimeType = "image/jpeg";
      }

      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64
        }
      });
    }
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: parts
      }
    ],

    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio,
        imageSize: "1K"
      }
    }
  };

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },

    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini API Error:", data);

    const message =
      data?.error?.message ||
      data?.error?.status ||
      "Gemini API request failed.";

    throw new Error(message);
  }

  const candidates = data?.candidates || [];

  for (const candidate of candidates) {
    const responseParts = candidate?.content?.parts || [];

    for (const part of responseParts) {
      if (part.inlineData?.data) {
        const mimeType =
          part.inlineData.mimeType || "image/png";

        return {
          image:
            `data:${mimeType};base64,${part.inlineData.data}`
        };
      }
    }
  }

  throw new Error(
    "Gemini returned no image. Try a different prompt."
  );
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });

    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/") {
    const indexPath = path.join(__dirname, "index.html");

    if (!fs.existsSync(indexPath)) {
      sendJSON(res, 500, {
        error: "index.html not found."
      });

      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8"
    });

    fs.createReadStream(indexPath).pipe(res);

    return;
  }

  // Generate image
  if (
    req.method === "POST" &&
    (
      req.url === "/api/generate-image" ||
      req.url === "/.netlify/functions/generate-image"
    )
  ) {
    let rawBody = "";

    req.on("data", chunk => {
      rawBody += chunk;
    });

    req.on("end", async () => {
      try {
        const body = JSON.parse(rawBody || "{}");

        const result = await generateImage(body);

        sendJSON(res, 200, result);

      } catch (error) {
        console.error("Generation Error:", error);

        sendJSON(res, 500, {
          error: error.message || "Image generation failed."
        });
      }
    });

    return;
  }

  // Serve static files
  if (req.method === "GET") {
    let requestedPath = req.url.split("?")[0];

    if (requestedPath === "/") {
      requestedPath = "/index.html";
    }

    const filePath = path.join(
      __dirname,
      requestedPath
    );

    if (
      !filePath.startsWith(__dirname) ||
      !fs.existsSync(filePath)
    ) {
      sendJSON(res, 404, {
        error: "File not found."
      });

      return;
    }

    const ext = path.extname(filePath).toLowerCase();

    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, {
      "Content-Type":
        contentTypes[ext] || "application/octet-stream"
    });

    fs.createReadStream(filePath).pipe(res);

    return;
  }

  sendJSON(res, 404, {
    error: "Not found."
  });
});

server.listen(PORT, () => {
  console.log(`AI TC server running on port ${PORT}`);
  console.log(`Image model: ${MODEL}`);
});
