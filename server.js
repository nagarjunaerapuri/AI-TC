const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

function send(res, status, data, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(data);
}

const server = http.createServer((req, res) => {

  // Website
  if (req.method === "GET" && req.url === "/") {
    try {
      const file = fs.readFileSync(
        path.join(__dirname, "index.html")
      );

      return send(res, 200, file, "text/html");
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

  // Image generation
  if (
    req.method === "POST" &&
    req.url === "/.netlify/functions/generate-image"
  ) {

    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", async () => {

      try {
        const data = JSON.parse(body || "{}");

        const prompt = data.prompt;
        const aspectRatio = data.aspectRatio || "1:1";

        if (!prompt) {
          return send(
            res,
            400,
            JSON.stringify({
              error: "Prompt is required."
            })
          );
        }

        // Clean API key
        const apiKey = (process.env.GEMINI_API_KEY || "")
          .replace(/\r?\n/g, "")
          .trim();

        if (!apiKey) {
          return send(
            res,
            500,
            JSON.stringify({
              error: "GEMINI_API_KEY is not configured."
            })
          );
        }

        const requestBody = {
          contents: [
            {
              parts: [
                {
                  text:
                    "Create a high-quality professional AI-generated image based on the user's request. Understand the user's prompt in its original language. Carefully follow the subject, scene, composition, lighting, details and aspect ratio. Create a polished professional image. User request: " +
                    prompt
                }
              ]
            }
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
            responseFormat: {
              image: {
                aspectRatio: aspectRatio,
                imageSize: "2K"
              }
            }
          }
        };

        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify(requestBody)
          }
        );

        const result = await response.json();

        if (!response.ok) {
          return send(
            res,
            response.status,
            JSON.stringify({
              error:
                result?.error?.message ||
                "Gemini API error."
            })
          );
        }

        const parts =
          result?.candidates?.[0]?.content?.parts || [];

        const imagePart = parts.find(
          part => part.inlineData
        );

        if (!imagePart) {
          return send(
            res,
            500,
            JSON.stringify({
              error: "Gemini did not return an image."
            })
          );
        }

        const mimeType =
          imagePart.inlineData.mimeType ||
          "image/png";

        const base64 =
          imagePart.inlineData.data;

        const image =
          `data:${mimeType};base64,${base64}`;

        return send(
          res,
          200,
          JSON.stringify({
            image: image
          })
        );

      } catch (error) {

        return send(
          res,
          500,
          JSON.stringify({
            error:
              error.message ||
              "Server error."
          })
        );
      }
    });

    return;
  }

  send(
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
