/**
 * FFmpeg Video Assembly Module for Project Kiwul
 *
 * Assembles final video from scene assets:
 * 1. Write scene images & audio to temporary disk files
 * 2. Create per-scene video clips (image + audio → .mp4)
 * 3. Concatenate all scene clips into one video
 * 4. Burn SRT subtitles into the final video
 * 5. Add background music (optional)
 * 6. Output final .mp4 at project resolution
 *
 * Uses child_process.spawn to call FFmpeg directly (no fluent-ffmpeg dependency).
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FFmpegSceneAsset {
  sceneNumber: number;
  /** Absolute path to image file on disk (PNG/JPG/WebP) */
  imagePath: string | null;
  /** Base64 data URL of the image (fallback if imagePath is null) */
  imageBase64: string | null;
  /** Base64 data URL of the audio (or null if no audio) */
  audioBase64: string | null;
  /** Voice text for subtitle generation */
  voiceText: string;
  /** Duration in seconds for this scene (0 = auto-detect from audio) */
  durationSeconds: number;
  /** Motion prompt for Ken Burns effect (optional) */
  motionPrompt?: string;
}

export interface FFmpegAssemblyConfig {
  /** Output directory for final video */
  outputDir: string;
  /** Project ID (used for filenames) */
  projectId: string;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Frames per second (default 30) */
  fps: number;
  /** SRT subtitle content (will be burned into video) */
  subtitleSrt: string;
  /** Background music file path (optional) */
  backgroundMusicPath?: string;
  /** Background music volume (0.0 to 1.0, default 0.15) */
  backgroundMusicVolume?: number;
  /** Default scene duration when no audio (seconds, default 6) */
  defaultSceneDuration: number;
  /** Whether to apply Ken Burns motion effect to static images */
  enableKenBurns: boolean;
}

export interface FFmpegAssemblyResult {
  /** Absolute path to the final assembled video */
  outputPath: string;
  /** Duration of the final video in seconds */
  durationSeconds: number;
  /** File size in bytes */
  fileSizeBytes: number;
  /** Number of scenes successfully assembled */
  sceneCount: number;
}

export type FFmpegLogCallback = (msg: string) => void;

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Run an FFmpeg command and return a promise.
 * Rejects on non-zero exit code with stderr output.
 */
function runFFmpeg(
  args: string[],
  onLog?: FFmpegLogCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";

    if (onLog) onLog(`[FFMPEG] Running: ${ffmpegPath} ${args.join(" ")}`);

    const proc = spawn(ffmpegPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderrOutput = "";

    proc.stdout.on("data", (data: Buffer) => {
      // FFmpeg progress info goes to stderr, stdout is usually empty
    });

    proc.stderr.on("data", (data: Buffer) => {
      const text = data.toString();
      stderrOutput += text;

      // Parse progress lines like "frame=  120 fps= 30 q=28.0 size=    1024kB time=00:00:04.00 bitrate= 2097.2kbits/s speed=   1x"
      const progressMatch = text.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (progressMatch && onLog) {
        // Only log every ~2 seconds worth of progress to avoid spam
        onLog(`[FFMPEG] Progress: time=${progressMatch[1]}`);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        const lastLines = stderrOutput.split("\n").slice(-5).join("\n");
        reject(new Error(`FFmpeg exited with code ${code}: ${lastLines}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

/**
 * Get the duration of an audio file in seconds using ffprobe.
 */
async function getAudioDuration(
  filePath: string,
  onLog?: FFmpegLogCallback
): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
    const proc = spawn(ffprobePath, [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);

    let output = "";
    proc.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        if (!isNaN(duration) && duration > 0) {
          resolve(duration);
        } else {
          resolve(0);
        }
      } else {
        resolve(0); // Return 0 on error, will use default duration
      }
    });

    proc.on("error", () => {
      resolve(0); // Return 0 on error
    });
  });
}

/**
 * Write a base64 data URL to a file on disk.
 * Returns the absolute file path.
 */
function writeBase64ToFile(dataUrl: string, filePath: string): string {
  const base64Match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!base64Match) {
    throw new Error(`Invalid data URL format for file: ${filePath}`);
  }

  const buffer = Buffer.from(base64Match[1], "base64");
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Determine the file extension from a base64 data URL's MIME type.
 */
function getExtensionFromDataUrl(dataUrl: string): string {
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  if (mimeMatch) {
    const mime = mimeMatch[1];
    if (mime.includes("png")) return "png";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    if (mime.includes("webp")) return "webp";
    if (mime.includes("wav")) return "wav";
    if (mime.includes("mp3")) return "mp3";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("webm")) return "webm";
  }
  return "bin";
}

/**
 * Parse Ken Burns motion prompt into FFmpeg zoompan filter parameters.
 * Returns a zoompan filter string for FFmpeg.
 */
function parseKenBurnsFilter(
  motionPrompt: string,
  durationSeconds: number,
  fps: number = 30
): string {
  const prompt = (motionPrompt || "").toLowerCase();
  const totalFrames = Math.ceil(durationSeconds * fps);

  // Default: subtle zoom in
  let zoomStart = 1.0;
  let zoomEnd = 1.15;
  let xExpr = "'iw/2-(iw/zoom/2)'";
  let yExpr = "'ih/2-(ih/zoom/2)'";

  if (prompt.includes("zoom out") || prompt.includes("pullback") || prompt.includes("pull back") || prompt.includes("crane up")) {
    zoomStart = 1.15;
    zoomEnd = 1.0;
  } else if (prompt.includes("pan left") || prompt.includes("sweep left")) {
    xExpr = "'iw/2-(iw/zoom/2)-on*2'";
    yExpr = "'ih/2-(ih/zoom/2)'";
    zoomStart = 1.1;
    zoomEnd = 1.1;
  } else if (prompt.includes("pan right") || prompt.includes("sweep right")) {
    xExpr = "'iw/2-(iw/zoom/2)+on*2'";
    yExpr = "'ih/2-(ih/zoom/2)'";
    zoomStart = 1.1;
    zoomEnd = 1.1;
  } else if (prompt.includes("dolly") || prompt.includes("push") || prompt.includes("forward") || prompt.includes("tracking")) {
    zoomStart = 1.0;
    zoomEnd = 1.25;
  } else if (prompt.includes("aerial") || prompt.includes("overhead") || prompt.includes("bird")) {
    zoomStart = 1.2;
    zoomEnd = 1.0;
    xExpr = "'iw/2-(iw/zoom/2)+on*0.5'";
    yExpr = "'ih/2-(ih/zoom/2)-on*0.5'";
  } else if (prompt.includes("handheld") || prompt.includes("shake")) {
    // Simulate handheld with slight random zoom oscillation
    zoomStart = 1.05;
    zoomEnd = 1.05;
    xExpr = "'iw/2-(iw/zoom/2)+sin(on*0.3)*3'";
    yExpr = "'ih/2-(ih/zoom/2)+cos(on*0.4)*2'";
  }

  // Linear interpolation between zoomStart and zoomEnd
  const zoomExpr = `'${zoomStart}+(${zoomEnd}-${zoomStart})*on/${totalFrames}'`;

  return `zoompan=z=${zoomExpr}:x=${xExpr}:y=${yExpr}:d=${totalFrames}:s=1280x720:fps=${fps}`;
}

// ─── Main Assembly Pipeline ─────────────────────────────────────────────────

/**
 * Full video assembly pipeline: images + audio → scene clips → concat → subtitle burn → final .mp4
 */
export async function assembleVideo(
  scenes: FFmpegSceneAsset[],
  config: FFmpegAssemblyConfig,
  onLog?: FFmpegLogCallback
): Promise<FFmpegAssemblyResult> {
  const startTime = Date.now();

  // Ensure output directories exist
  const tempDir = path.join(config.outputDir, "temp");
  const finalDir = path.join(config.outputDir, "final");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

  if (onLog) onLog(`[FFMPEG] Starting video assembly for ${scenes.length} scenes...`);
  if (onLog) onLog(`[FFMPEG] Resolution: ${config.width}x${config.height}, FPS: ${config.fps}`);

  // ─── Step 1: Prepare scene assets on disk ────────────────────────────
  if (onLog) onLog(`[FFMPEG] Step 1/5: Writing scene assets to disk...`);

  const sceneAssets: Array<{
    sceneNumber: number;
    imagePath: string;
    audioPath: string | null;
    durationSeconds: number;
    motionPrompt: string;
  }> = [];

  for (const scene of scenes) {
    const sceneTempDir = path.join(tempDir, `scene_${scene.sceneNumber}`);
    if (!fs.existsSync(sceneTempDir)) fs.mkdirSync(sceneTempDir, { recursive: true });

    // Write image to disk
    let imgPath = scene.imagePath;
    if (!imgPath || !fs.existsSync(imgPath)) {
      if (scene.imageBase64) {
        const ext = getExtensionFromDataUrl(scene.imageBase64);
        imgPath = path.join(sceneTempDir, `image.${ext}`);
        writeBase64ToFile(scene.imageBase64, imgPath);
        if (onLog) onLog(`[FFMPEG] Scene ${scene.sceneNumber}: Image written to disk (${ext})`);
      } else {
        if (onLog) onLog(`[FFMPEG] WARNING: Scene ${scene.sceneNumber} has no image! Skipping.`);
        continue;
      }
    }

    // Write audio to disk
    let audioPath: string | null = null;
    if (scene.audioBase64) {
      try {
        const ext = getExtensionFromDataUrl(scene.audioBase64);
        audioPath = path.join(sceneTempDir, `audio.${ext}`);
        writeBase64ToFile(scene.audioBase64, audioPath);
        if (onLog) onLog(`[FFMPEG] Scene ${scene.sceneNumber}: Audio written to disk (${ext})`);
      } catch (err: any) {
        if (onLog) onLog(`[FFMPEG] WARNING: Scene ${scene.sceneNumber} audio write failed: ${err.message}`);
        audioPath = null;
      }
    }

    // Determine scene duration
    let duration = scene.durationSeconds || config.defaultSceneDuration;
    if (audioPath) {
      const audioDuration = await getAudioDuration(audioPath, onLog);
      if (audioDuration > 0) {
        duration = audioDuration + 0.5; // Add 0.5s padding after audio
        if (onLog) onLog(`[FFMPEG] Scene ${scene.sceneNumber}: Audio duration = ${audioDuration.toFixed(1)}s, scene duration = ${duration.toFixed(1)}s`);
      }
    }

    sceneAssets.push({
      sceneNumber: scene.sceneNumber,
      imagePath: imgPath,
      audioPath,
      durationSeconds: duration,
      motionPrompt: scene.motionPrompt || "",
    });
  }

  if (sceneAssets.length === 0) {
    throw new Error("No valid scene assets found for video assembly. Ensure scenes have images.");
  }

  // ─── Step 2: Create per-scene video clips ────────────────────────────
  if (onLog) onLog(`[FFMPEG] Step 2/5: Creating ${sceneAssets.length} scene video clips...`);

  const sceneClipPaths: string[] = [];

  for (let i = 0; i < sceneAssets.length; i++) {
    const asset = sceneAssets[i];
    const clipPath = path.join(tempDir, `scene_${asset.sceneNumber}_clip.mp4`);

    if (onLog) onLog(`[FFMPEG] Processing scene ${asset.sceneNumber}/${sceneAssets.length}...`);

    try {
      // Build FFmpeg args for image → video with optional Ken Burns + audio
      const args: string[] = [];

      // Input: image
      args.push("-loop", "1");
      args.push("-i", asset.imagePath);

      // Input: audio (if available)
      let hasAudio = false;
      if (asset.audioPath && fs.existsSync(asset.audioPath)) {
        args.push("-i", asset.audioPath);
        hasAudio = true;
      }

      // Video filter: scale + Ken Burns or static
      const filters: string[] = [];

      // Scale to target resolution
      filters.push(`scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2:color=black`);

      // Apply Ken Burns effect if enabled
      if (config.enableKenBurns && asset.motionPrompt) {
        const kenBurnsFilter = parseKenBurnsFilter(asset.motionPrompt, asset.durationSeconds, config.fps);
        filters.push(kenBurnsFilter);
      } else {
        // Static image with fps
        filters.push(`fps=${config.fps}`);
      }

      args.push("-vf", filters.join(","));

      // Duration
      args.push("-t", asset.durationSeconds.toString());

      // Audio settings
      if (hasAudio) {
        args.push("-map", "0:v", "-map", "1:a");
        args.push("-c:v", "libx264");
        args.push("-preset", "medium");
        args.push("-crf", "23");
        args.push("-c:a", "aac");
        args.push("-b:a", "128k");
        args.push("-shortest");
      } else {
        // No audio - generate silent audio track
        args.push("-c:v", "libx264");
        args.push("-preset", "medium");
        args.push("-crf", "23");
        // Add silent audio
        args.push("-f", "lavfi");
        args.push("-i", `anullsrc=channel_layout=stereo:sample_rate=44100`);
        args.push("-map", "0:v", "-map", "1:a");
        args.push("-c:a", "aac");
        args.push("-b:a", "128k");
        args.push("-shortest");
      }

      // Common video settings
      args.push("-pix_fmt", "yuv420p");
      args.push("-movflags", "+faststart");
      args.push("-y"); // Overwrite output

      args.push(clipPath);

      await runFFmpeg(args, onLog);

      sceneClipPaths.push(clipPath);
      if (onLog) onLog(`[FFMPEG] Scene ${asset.sceneNumber} clip created: ${clipPath}`);
    } catch (err: any) {
      if (onLog) onLog(`[FFMPEG] WARNING: Scene ${asset.sceneNumber} clip failed: ${err.message}. Creating fallback black frame clip.`);

      // Fallback: create a black frame with text
      try {
        const fallbackArgs = [
          "-f", "lavfi", "-i", `color=c=black:s=${config.width}x${config.height}:d=${asset.durationSeconds}:r=${config.fps}`,
          "-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=44100`,
          "-vf", `drawtext=text:'Scene ${asset.sceneNumber}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2,fps=${config.fps}`,
          "-map", "0:v", "-map", "1:a",
          "-c:v", "libx264", "-preset", "medium", "-crf", "23",
          "-c:a", "aac", "-b:a", "128k",
          "-pix_fmt", "yuv420p",
          "-t", asset.durationSeconds.toString(),
          "-shortest",
          "-y",
          clipPath,
        ];
        await runFFmpeg(fallbackArgs, onLog);
        sceneClipPaths.push(clipPath);
      } catch (fallbackErr: any) {
        if (onLog) onLog(`[FFMPEG] ERROR: Scene ${asset.sceneNumber} fallback also failed: ${fallbackErr.message}`);
      }
    }
  }

  if (sceneClipPaths.length === 0) {
    throw new Error("No scene clips could be created. Video assembly failed.");
  }

  // ─── Step 3: Concatenate all scene clips ─────────────────────────────
  if (onLog) onLog(`[FFMPEG] Step 3/5: Concatenating ${sceneClipPaths.length} scene clips...`);

  // Create concat list file
  const concatListPath = path.join(tempDir, "concat_list.txt");
  const concatContent = sceneClipPaths
    .map((p) => `file '${p}'`)
    .join("\n");
  fs.writeFileSync(concatListPath, concatContent);

  const concatenatedPath = path.join(tempDir, "concatenated.mp4");

  await runFFmpeg([
    "-f", "concat", "-safe", "0",
    "-i", concatListPath,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y",
    concatenatedPath,
  ], onLog);

  if (onLog) onLog(`[FFMPEG] Concatenated video: ${concatenatedPath}`);

  // ─── Step 4: Burn subtitles into video ───────────────────────────────
  let videoWithSubsPath = concatenatedPath;

  if (config.subtitleSrt && config.subtitleSrt.trim().length > 0) {
    if (onLog) onLog(`[FFMPEG] Step 4/5: Burning subtitles into video...`);

    // Write SRT to disk
    const srtPath = path.join(tempDir, "subtitles.srt");
    fs.writeFileSync(srtPath, config.subtitleSrt, "utf-8");

    videoWithSubsPath = path.join(tempDir, "with_subtitles.mp4");

    // Escape the SRT path for FFmpeg (Windows needs escaped backslashes, Linux is fine)
    const escapedSrtPath = srtPath.replace(/'/g, "'\\''");

    await runFFmpeg([
      "-i", concatenatedPath,
      "-vf", `subtitles='${escapedSrtPath}':force_style='FontName=Arial,FontSize=16,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Shadow=1,MarginV=30'`,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "23",
      "-c:a", "copy",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-y",
      videoWithSubsPath,
    ], onLog);

    if (onLog) onLog(`[FFMPEG] Subtitles burned successfully`);
  } else {
    if (onLog) onLog(`[FFMPEG] Step 4/5: No subtitles to burn, skipping.`);
  }

  // ─── Step 5: Add background music (optional) ────────────────────────
  let finalVideoPath = videoWithSubsPath;

  if (config.backgroundMusicPath && fs.existsSync(config.backgroundMusicPath)) {
    if (onLog) onLog(`[FFMPEG] Step 5/5: Adding background music...`);

    finalVideoPath = path.join(finalDir, `${config.projectId}_final_with_music.mp4`);
    const musicVolume = config.backgroundMusicVolume ?? 0.15;

    // Get the video duration to loop/trim the music
    await runFFmpeg([
      "-i", videoWithSubsPath,
      "-i", config.backgroundMusicPath,
      "-filter_complex", `[1:a]volume=${musicVolume}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=3[aout]`,
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      "-movflags", "+faststart",
      "-y",
      finalVideoPath,
    ], onLog);

    if (onLog) onLog(`[FFMPEG] Background music added`);
  } else {
    if (onLog) onLog(`[FFMPEG] Step 5/5: No background music, copying to final output...`);

    // Just copy the video to the final directory
    finalVideoPath = path.join(finalDir, `${config.projectId}_final.mp4`);
    fs.copyFileSync(videoWithSubsPath, finalVideoPath);
  }

  // ─── Cleanup temp files ──────────────────────────────────────────────
  try {
    // Remove temp directory to save space
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (onLog) onLog(`[FFMPEG] Temporary files cleaned up`);
  } catch (err: any) {
    if (onLog) onLog(`[FFMPEG] Warning: Could not clean temp files: ${err.message}`);
  }

  // ─── Calculate result ────────────────────────────────────────────────
  const stat = fs.statSync(finalVideoPath);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Get final video duration
  let durationSeconds = 0;
  try {
    durationSeconds = await getAudioDuration(finalVideoPath, onLog);
    // getAudioDuration actually returns the format duration which works for video too
  } catch {
    // Estimate from scene durations
    durationSeconds = sceneAssets.reduce((sum, a) => sum + a.durationSeconds, 0);
  }

  if (onLog) onLog(`[FFMPEG] Video assembly complete in ${elapsed}s!`);
  if (onLog) onLog(`[FFMPEG] Output: ${finalVideoPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB, ${durationSeconds.toFixed(1)}s)`);

  return {
    outputPath: finalVideoPath,
    durationSeconds,
    fileSizeBytes: stat.size,
    sceneCount: sceneClipPaths.length,
  };
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Check if FFmpeg is available on the system.
 */
export async function checkFFmpegAvailability(): Promise<{
  available: boolean;
  version: string | null;
  path: string | null;
}> {
  try {
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const proc = spawn(ffmpegPath, ["-version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    return new Promise((resolve) => {
      let output = "";
      proc.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });
      proc.stderr.on("data", (data: Buffer) => {
        output += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          const versionMatch = output.match(/ffmpeg version (\S+)/);
          resolve({
            available: true,
            version: versionMatch ? versionMatch[1] : "unknown",
            path: ffmpegPath,
          });
        } else {
          resolve({ available: false, version: null, path: null });
        }
      });

      proc.on("error", () => {
        resolve({ available: false, version: null, path: null });
      });
    });
  } catch {
    return { available: false, version: null, path: null };
  }
}

/**
 * Get media file info using ffprobe.
 */
export async function getMediaInfo(
  filePath: string
): Promise<{
  duration: number;
  width: number;
  height: number;
  codec: string;
  fileSize: number;
} | null> {
  try {
    const ffprobePath = process.env.FFPROBE_PATH || "ffprobe";
    const proc = spawn(ffprobePath, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ]);

    return new Promise((resolve) => {
      let output = "";
      proc.stdout.on("data", (data: Buffer) => {
        output += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          try {
            const info = JSON.parse(output);
            const videoStream = info.streams?.find((s: any) => s.codec_type === "video");
            resolve({
              duration: parseFloat(info.format?.duration || "0"),
              width: videoStream?.width || 0,
              height: videoStream?.height || 0,
              codec: videoStream?.codec_name || "unknown",
              fileSize: parseInt(info.format?.size || "0"),
            });
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });

      proc.on("error", () => {
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

// ─── Video + Audio Merge ─────────────────────────────────────────────────────

/**
 * Merge a video file with an audio file using FFmpeg.
 * The output video will have the audio track replaced/added.
 * If the video is longer than the audio, the video is trimmed.
 * If the audio is longer than the video, the video loops or is trimmed to the shorter duration.
 *
 * @param videoPath  - Absolute path to the input video file (e.g., scene_x/video.mp4)
 * @param audioPath  - Absolute path to the input audio file (e.g., scene_x/audio.wav)
 * @param outputPath - Absolute path for the output merged video file
 * @param onLog      - Optional log callback
 * @returns Absolute path to the merged video file
 */
export async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  onLog?: FFmpegLogCallback
): Promise<string> {
  if (onLog) onLog(`[FFMPEG] Merging video + audio: ${videoPath} + ${audioPath}`);

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await runFFmpeg([
    "-i", videoPath,
    "-i", audioPath,
    "-map", "0:v",       // Use video from first input
    "-map", "1:a",       // Use audio from second input
    "-c:v", "copy",      // Copy video stream (no re-encode)
    "-c:a", "aac",       // Encode audio to AAC
    "-b:a", "128k",
    "-shortest",          // Stop when the shorter stream ends
    "-movflags", "+faststart",
    "-y",                 // Overwrite output
    outputPath,
  ], onLog);

  if (onLog) onLog(`[FFMPEG] Video+audio merged: ${outputPath}`);
  return outputPath;
}

/**
 * Merge a video with a silent audio track (when no TTS audio is available).
 * This ensures the final video has an audio stream for compatibility.
 */
export async function mergeVideoWithSilence(
  videoPath: string,
  outputPath: string,
  onLog?: FFmpegLogCallback
): Promise<string> {
  if (onLog) onLog(`[FFMPEG] Adding silent audio track to video: ${videoPath}`);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await runFFmpeg([
    "-i", videoPath,
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-map", "0:v",
    "-map", "1:a",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ], onLog);

  if (onLog) onLog(`[FFMPEG] Silent audio added: ${outputPath}`);
  return outputPath;
}
