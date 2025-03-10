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

// Use memory storage for multer to avoid disk writes where possible
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Create a temporary directory for processing
const getTempFilePath = (prefix) => path.join(os.tmpdir(), `${prefix}_${uuidv4()}`);

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

// Clean up temporary files safely
function cleanupFiles(...filePaths) {
  filePaths.forEach(filePath => {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (error) {
        console.error(`Failed to delete temporary file ${filePath}:`, error);
      }
    }
  });
}

app.post("/api/compress", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  
  // Get compression parameters from request
  const { fps = "30", bitrate = "1000k", width, height, format = "mp4" } = req.body;
  const { buffer, originalname, mimetype } = req.file;
  
  // Create unique temporary file paths
  const tempInputFilePath = getTempFilePath("input");
  const tempOutputFilePath = getTempFilePath("output");
  
  try {
    // Write buffer to temporary input file
    fs.writeFileSync(tempInputFilePath, buffer);
    
    // Set up compression command
    const command = ffmpeg(tempInputFilePath)
      // Video settings
      .videoCodec('libx264')
      .videoBitrate(bitrate)
      .fps(parseInt(fps))
      
      // Audio settings
      .audioCodec('aac')
      .audioBitrate('128k')
      
      // Add resolution if provided
      .outputOptions('-preset', 'ultrafast') // Fast encoding
      .outputOptions('-movflags', 'frag_keyframe+empty_moov') // For streaming compatibility
      .outputOptions('-strict', 'experimental') // Necessary for certain codecs
      
      // Set output format
      .toFormat(format);
    
    // Add resolution if provided
    if (width && height) {
      command.size(`${width}x${height}`);
    }
    
    // Set output path and handle events
    command.output(tempOutputFilePath)
      .on('start', () => {
        console.log(`Compression started for ${originalname}`);
      })
      .on('progress', (progress) => {
        console.log(`Processing: ${progress.percent ? progress.percent.toFixed(1) : 0}% done`);
      })
      .on('error', (err) => {
        console.error('Compression error:', err);
        cleanupFiles(tempInputFilePath, tempOutputFilePath);
        return res.status(500).json({ error: 'Video compression failed' });
      })
      .on('end', () => {
        console.log('Compression finished');
        
        try {
          // Read the compressed file
          const compressedBuffer = fs.readFileSync(tempOutputFilePath);
          
          // Set appropriate headers
          res.setHeader('Content-Type', `video/${format}`);
          res.setHeader('Content-Length', compressedBuffer.length);
          res.setHeader('Content-Disposition', `attachment; filename="compressed_${originalname}"`);
          
          // Send the compressed video
          res.status(200).send(compressedBuffer);
        } catch (error) {
          console.error('Error sending compressed video:', error);
          res.status(500).json({ error: 'Failed to send compressed video' });
        } finally {
          // Clean up temporary files
          cleanupFiles(tempInputFilePath, tempOutputFilePath);
        }
      })
      .run();
  } catch (error) {
    console.error('Unexpected error during compression:', error);
    cleanupFiles(tempInputFilePath, tempOutputFilePath);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Video compression server running on port ${PORT}`);
});
