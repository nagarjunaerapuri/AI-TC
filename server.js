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

  // Open website
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

  // Generate image
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

        // Aspect ratio → image dimensions
        let width = 1024;
        let height = 1024;

        if (aspectRatio === "16:9") {
          width = 1280;
          height = 720;
        }

        if (aspectRatio === "9:16") {
          width = 720;
          height = 1280;
        }

        if (aspectRatio === "4:5") {
          width = 1024;
          height = 1280;
        }

        if (aspectRatio === "3:2") {
          width = 1152;
          height = 768;
        }

        if (aspectRatio === "2:3") {
          width = 768;
          height = 1152;
        }

        const finalPrompt =
          "Create a high quality image based on this user prompt: " +
          prompt;

        const imageUrl =
          "https://image.pollinations.ai/prompt/" +
          encodeURIComponent(finalPrompt) +
          "?width=" +
          width +
          "&height=" +
          height +
          "&nologo=true";

        const imageResponse = await fetch(imageUrl);

        if (!imageResponse.ok) {
          throw new Error(
            "Image generation failed: " +
            imageResponse.status
          );
        }

        const imageBuffer =
          Buffer.from(
            await imageResponse.arrayBuffer()
          );

        const base64 =
          imageBuffer.toString("base64");

        const image =
          "data:image/jpeg;base64," + base64;

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
