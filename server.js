const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;

function send(res, status, data, type = "application/json") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  res.end(data);
}

function getSize(aspectRatio) {
  switch (aspectRatio) {
    case "16:9":
      return { width: 1024, height: 576 };

    case "9:16":
      return { width: 576, height: 1024 };

    case "4:5":
      return { width: 819, height: 1024 };

    case "3:2":
      return { width: 1024, height: 683 };

    case "2:3":
      return { width: 683, height: 1024 };

    default:
      return { width: 1024, height: 1024 };
  }
}

async function pixazoRequest(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "Ocp-Apim-Subscription-Key": PIXAZO_API_KEY
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Pixazo returned an invalid response: " + text.slice(0, 300)
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      data.error ||
      `Pixazo API error: ${response.status}`
    );
  }

  return data;
}

const server = http.createServer((req, res) => {

  // CORS preflight
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }

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

      // Prevent extremely large requests
      if (body.length > 35 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on("end", async () => {

      try {

        if (!PIXAZO_API_KEY) {
          return send(
            res,
            500,
            JSON.stringify({
              error:
                "PIXAZO_API_KEY is missing in Render Environment."
            })
          );
        }

        const data = JSON.parse(body || "{}");

        const prompt = String(data.prompt || "").trim();
        const aspectRatio = data.aspectRatio || "1:1";
        const mode = data.mode || "text";
        const referenceImage = data.referenceImage || "";

        if (!prompt) {
          return send(
            res,
            400,
            JSON.stringify({
              error: "Prompt is required."
            })
          );
        }

        /*
        ============================================
        TEXT TO IMAGE
        Stable Diffusion XL Lightning
        ============================================
        */

        if (mode === "text") {

          const size = getSize(aspectRatio);

          const result = await pixazoRequest(
            "https://gateway.pixazo.ai/sdxl_lightning/getImage/v1/getSDXLImage",
            {
              prompt: prompt,

              negativePrompt:
                "blurry, low quality, distorted, deformed, watermark, logo",

              width: size.width,
              height: size.height,

              num_steps: 20,
              guidance: 7.5,

              seed: Math.floor(
                Math.random() * 2147483647
              )
            }
          );

          const imageUrl =
            result.imageUrl ||
            result.output ||
            result.image ||
            result.url;

          if (!imageUrl) {
            throw new Error(
              "Pixazo did not return an image URL."
            );
          }

          return send(
            res,
            200,
            JSON.stringify({
              image: imageUrl
            })
          );
        }

        /*
        ============================================
        REFERENCE IMAGE
        Stable Diffusion 3.5 Image-to-Image
        ============================================
        */

        if (mode === "reference") {

          if (!referenceImage) {
            return send(
              res,
              400,
              JSON.stringify({
                error:
                  "Please upload a reference image first."
              })
            );
          }

          /*
          Pixazo's SD 3.5 API accepts an image
          reference together with the prompt.
          */

          const result = await pixazoRequest(
            "https://gateway.pixazo.ai/sd3-5/v1/r-sd-3-5-large",
            {
              prompt: prompt,

              image: referenceImage,

              prompt_strength: 0.75,

              cfg: 5,

              steps: 30,

              output_format: "webp",

              output_quality: 90
            }
          );

          const imageUrl =
            result.output ||
            result.imageUrl ||
            result.image ||
            result.url;

          if (!imageUrl) {
            throw new Error(
              "Pixazo did not return the reference image result."
            );
          }

          return send(
            res,
            200,
            JSON.stringify({
              image: imageUrl
            })
          );
        }

        return send(
          res,
          400,
          JSON.stringify({
            error: "Invalid generation mode."
          })
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
