const express = require("express");
const cors = require("cors");
const app = express();
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

const storage = multer.memoryStorage();
const upload = multer({ storage });

function getVideoDetails(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata);
      }
    });
  });
}

app.post("/api/details", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");

  const { buffer, originalname } = req.file;
  const tempInputFilePath = path.join(__dirname, `temp_${originalname}`);

  fs.writeFileSync(tempInputFilePath, buffer);

  try {
    const videoDetails = await getVideoDetails(tempInputFilePath);

    res.status(200).json({
      format: videoDetails.format.format_name,
      duration: videoDetails.format.duration,
      bitrate: videoDetails.format.bit_rate,
      fps: videoDetails.streams[0].r_frame_rate,
      codec: videoDetails.streams[0].codec_name,
    });
  } catch (error) {
    console.error("Error getting video details:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    fs.unlinkSync(tempInputFilePath);
  }
});

app.post("/api/compress", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");

  const { buffer, originalname } = req.file;
  const { fps, bitrate } = req.body;

  const tempInputFilePath = path.join(__dirname, `temp_${originalname}`);
  const ext = path.extname(originalname);
  const outputFileName = `compressed_${originalname}`;
  const tempOutputFilePath = path.join(__dirname, outputFileName);

  fs.writeFileSync(tempInputFilePath, buffer);

  ffmpeg()
    .input(tempInputFilePath)
    .videoBitrate(bitrate || "1000k") // Default bitrate if not provided
    .fps(fps || 30) // Default fps if not provided
    .output(tempOutputFilePath)
    .outputOptions("-preset", "fast") // Optimize for faster processing
    .outputOptions("-movflags", "faststart") // Optimize for streaming
    .on("start", () => console.log("Compression started..."))
    .on("end", async () => {
      console.log("Compression finished");

      res.download(tempOutputFilePath, outputFileName, (err) => {
        if (err) console.error("Download error:", err);
        fs.unlinkSync(tempInputFilePath);
        fs.unlinkSync(tempOutputFilePath);
      });
    })
    .on("error", (err) => {
      console.error("Error during compression:", err);
      res.status(500).send("Compression failed");
    })
    .run();
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
