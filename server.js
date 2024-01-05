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
  const { buffer } = req.file;

  const tempInputFilePath = path.join(__dirname, "temp_input.mp4");
  // Write the buffer to a temporary file
  fs.writeFileSync(tempInputFilePath, buffer);
  const VideoDetails = await getVideoDetails(tempInputFilePath);

  res.status(200).json({
    bitrate: VideoDetails.format.bit_rate,
    fps: VideoDetails.streams[0].r_frame_rate,
  });

  fs.unlinkSync(tempInputFilePath);
});

app.post("/api/compress", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }
  const { fps, bitrate } = req.body;

  const { buffer, originalname } = req.file;

  const outputFileName = "compressed_" + originalname;
  const tempInputFilePath = path.join(__dirname, "temp_input.mp4");

  // Write the buffer to a temporary file
  fs.writeFileSync(tempInputFilePath, buffer);

  const command = ffmpeg()
    .input(tempInputFilePath)
    .audioBitrate(fps)
    .videoBitrate(bitrate)
    .output(outputFileName)
    .outputOptions("-c:v", "libx264") // Use libx264 for better compatibility with base64
    .outputOptions("-c:a", "aac") // Use AAC for audio
    .outputOptions("-strict", "experimental") // Necessary for certain codecs
    .outputOptions("-movflags", "frag_keyframe+empty_moov") // For streaming compatibility
    .toFormat("mp4") // Specify the output format
    .on("start", () => {
      console.log("Compression Started");
    })
    .on("end", async () => {
      console.log("Compression finished");

      const compressedVideoStream = fs.createReadStream(outputFileName);

      // Use fs.stat to get file information
      fs.stat(outputFileName, (err, stats) => {
        if (err) {
          console.error("Error getting file stats:", err);
        } else {
          // Set the response headers
          res.status(200);
          res.set({
            "Content-Type": "video/mp4",
            "Content-Length": stats.size, // Set the Content-Length header
          });
          // Pipe the compressed video stream directly to the response
          compressedVideoStream.pipe(res);
          // Delete the temporary files after piping is done
          compressedVideoStream.on("end", () => {
            fs.unlinkSync(tempInputFilePath);
            fs.unlinkSync(outputFileName);
          });
        }
      });
    })
    .on("error", (err) => {
      console.error("Error:", err);
      res.status(500).send("Error occurred during compression");
    })
    .run();
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
