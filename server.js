const express = require("express");
const cors = require("cors");
const app = express();
const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const os = require("os");

const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// Use memory storage for multer
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Create a temporary directory for processing
const getTempFilePath = (prefix) => path.join(os.tmpdir(), `${prefix}_${uuidv4()}.mp4`);

// Get available formats from ffmpeg
let availableFormats = [];
ffmpeg.getAvailableFormats((err, formats) => {
  if (!err) {
    availableFormats = Object.keys(formats);
    console.log("Available formats:", availableFormats);
  } else {
    console.error("Error getting available formats:", err);
  }
});

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

// Improved cleanup function with retry mechanism
function cleanupFiles(...filePaths) {
  filePaths.forEach(filePath => {
    if (filePath && fs.existsSync(filePath)) {
      const deleteWithRetry = (path, retries = 5, delay = 1000) => {
        try {
          fs.unlinkSync(path);
          console.log(`Successfully deleted: ${path}`);
        } catch (error) {
          console.log(`Failed to delete ${path}, retries left: ${retries}`);
          if (retries > 0) {
            setTimeout(() => deleteWithRetry(path, retries - 1, delay), delay);
          } else {
            console.error(`Could not delete file after multiple attempts: ${path}`, error);
          }
        }
      };

      deleteWithRetry(filePath);
    }
  });
}

app.post("/api/details", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { buffer, originalname } = req.file;
  const tempInputFilePath = getTempFilePath(originalname);

  try {
    fs.writeFileSync(tempInputFilePath, buffer);
    const videoDetails = await getVideoDetails(tempInputFilePath);

    // Extract relevant video information
    const format = videoDetails.format;
    const videoStream = videoDetails.streams.find(s => s.codec_type === 'video');
    const audioStream = videoDetails.streams.find(s => s.codec_type === 'audio');

    res.status(200).json({
      format: format.format_name,
      duration: format.duration,
      size: format.size,
      bitrate: format.bit_rate,
      video: videoStream ? {
        codec: videoStream.codec_name,
        width: videoStream.width,
        height: videoStream.height,
        fps: videoStream.r_frame_rate ? eval(videoStream.r_frame_rate) : null,
        bitrate: videoStream.bit_rate
      } : null,
      audio: audioStream ? {
        codec: audioStream.codec_name,
        channels: audioStream.channels,
        sample_rate: audioStream.sample_rate,
        bitrate: audioStream.bit_rate
      } : null
    });
  } catch (error) {
    console.error("Error getting video details:", error);
    res.status(500).json({ error: "Failed to process video details" });
  } finally {
    // Schedule cleanup for later to avoid EBUSY
    setTimeout(() => cleanupFiles(tempInputFilePath), 1000);
  }
});

app.post("/api/compress", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  // Get compression parameters from request
  let { fps = "30", width, height } = req.body;
  const { buffer, originalname } = req.file;

  // Create unique temporary file paths with extensions
  const tempInputFilePath = getTempFilePath("input");
  const tempOutputFilePath = getTempFilePath("output");

  try {
    // Write buffer to temporary input file
    fs.writeFileSync(tempInputFilePath, buffer);

    console.log("Using output format: mp4");

    // Set up compression command
    const command = ffmpeg(tempInputFilePath);

    // Configure video settings
    command.videoCodec('libx264')
      .fps(parseInt(fps)); // Remove videoBitrate

    // Configure audio settings if needed
    command.audioCodec('aac')
      .audioBitrate('128k');

    // Add resolution if provided
    if (width && height) {
      command.size(`${width}x${height}`);
    }

    // Add output options
    command.outputOptions([
      '-preset', 'ultrafast',
      '-movflags', 'frag_keyframe+empty_moov',
      '-strict', 'experimental'
    ]);

    // Set output path
    command.save(tempOutputFilePath)
      .on('start', (commandLine) => {
        console.log(`Compression started with command: ${commandLine}`);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent ? progress.percent.toFixed(1) : 0}% done`);
      })
      .on('error', (err) => {
        console.error('Compression error:', err);
        setTimeout(() => cleanupFiles(tempInputFilePath, tempOutputFilePath), 1000);
        return res.status(500).json({ error: 'Video compression failed', details: err.message });
      })
      .on('end', () => {
        console.log('Compression finished');

        try {
          const compressedBuffer = fs.readFileSync(tempOutputFilePath);

          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Length', compressedBuffer.length);
          res.setHeader('Content-Disposition', `attachment; filename="compressed_${originalname}"`);

          res.status(200).send(compressedBuffer);

          setTimeout(() => cleanupFiles(tempInputFilePath, tempOutputFilePath), 2000);
        } catch (error) {
          console.error('Error sending compressed video:', error);
          res.status(500).json({ error: 'Failed to send compressed video' });
          setTimeout(() => cleanupFiles(tempInputFilePath, tempOutputFilePath), 1000);
        }
      });
  } catch (error) {
    console.error('Unexpected error during compression:', error);
    setTimeout(() => cleanupFiles(tempInputFilePath, tempOutputFilePath), 1000);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});


// Add a route to check available formats
app.get("/api/formats", (req, res) => {
  res.json({ formats: availableFormats });
});

app.listen(PORT, () => {
  console.log(`Video compression server running on port ${PORT}`);
});
