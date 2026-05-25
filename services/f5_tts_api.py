"""
F5-TTS FastAPI Wrapper for Project Kiwul
=========================================

A clean REST API that wraps the F5-TTS Gradio webui running on port 5000,
exposing it on port 5050 for Kiwul's tts.ts module to consume.

Endpoints:
  GET  /health     — Health check
  POST /synthesize — Text-to-speech synthesis
  GET  /voices     — List available voice profiles

Fallback: If the Gradio API is unavailable, falls back to f5-tts_infer CLI.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import struct
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import httpx
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── Configuration ───────────────────────────────────────────────────────────

GRADIO_BASE_URL = os.getenv("F5_TTS_GRADIO_URL", "http://localhost:5000")
WRAPPER_PORT = int(os.getenv("F5_TTS_WRAPPER_PORT", "5050"))
REQUEST_TIMEOUT = float(os.getenv("F5_TTS_REQUEST_TIMEOUT", "120"))
VOICE_PROFILES_DIR = os.getenv("F5_TTS_VOICE_PROFILES_DIR", "")
LOG_LEVEL = os.getenv("F5_TTS_LOG_LEVEL", "INFO").upper()

# ─── Logging ─────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("f5-tts-wrapper")

# ─── Voice Profiles ─────────────────────────────────────────────────────────

# Built-in voice profiles mapping: profile_name -> (ref_audio_path, ref_text)
# These can be overridden by placing .wav files in VOICE_PROFILES_DIR
BUILTIN_VOICE_PROFILES: dict[str, dict[str, str]] = {
    "natural_charles": {
        "ref_text": "The quick brown fox jumps over the lazy dog.",
    },
    "natural_puck": {
        "ref_text": "Hello, welcome to the voice synthesis system.",
    },
    "natural_kore": {
        "ref_text": "Today is a beautiful day for speech synthesis.",
    },
    "default": {
        "ref_text": "Hello, this is a default voice profile.",
    },
}

# ─── FastAPI App ─────────────────────────────────────────────────────────────

app = FastAPI(
    title="F5-TTS Wrapper API",
    description="Clean REST API wrapper around F5-TTS Gradio for Project Kiwul",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Request / Response Models ───────────────────────────────────────────────


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Text to synthesize")
    voice_profile: str = Field(default="default", description="Voice profile name")
    speed: float = Field(default=1.0, ge=0.25, le=4.0, description="Speech speed multiplier")
    ref_audio: Optional[str] = Field(default=None, description="Reference audio as base64 data URL")
    ref_text: Optional[str] = Field(default=None, description="Reference text for voice cloning")

    class Config:
        json_schema_extra = {
            "example": {
                "text": "Hello, this is a test of the F5-TTS synthesis system.",
                "voice_profile": "natural_charles",
                "speed": 1.0,
            }
        }


class SynthesizeResponse(BaseModel):
    audio: str = Field(..., description="Base64-encoded WAV audio")
    duration_seconds: float = Field(..., description="Estimated audio duration in seconds")
    engine: str = Field(default="f5-tts", description="Engine used for synthesis")
    sample_rate: Optional[int] = Field(default=None, description="Audio sample rate in Hz")


class VoiceProfile(BaseModel):
    name: str
    ref_text: str
    has_ref_audio: bool
    source: str  # "builtin" or "file"


class VoicesResponse(BaseModel):
    voices: list[VoiceProfile]
    count: int


class HealthResponse(BaseModel):
    status: str
    engine: str
    gradio_available: bool
    gradio_url: str
    cli_available: bool


# ─── HTTP Client (shared, reused) ───────────────────────────────────────────

_http_client: Optional[httpx.AsyncClient] = None


async def get_http_client() -> httpx.AsyncClient:
    """Get or create the shared async HTTP client."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(REQUEST_TIMEOUT, connect=10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up the HTTP client on shutdown."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


# ─── Utility Functions ───────────────────────────────────────────────────────


def estimate_wav_duration(wav_bytes: bytes) -> float:
    """
    Estimate the duration of a WAV file from its header.

    Parses the RIFF/WAV header to extract byte rate and data size,
    then calculates duration = data_size / byte_rate.
    """
    try:
        if len(wav_bytes) < 44:
            return 0.0

        # Check RIFF header
        if wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
            # Not a standard WAV — estimate based on size
            return len(wav_bytes) / 176400.0  # assume 44.1kHz 16-bit stereo

        byte_rate = struct.unpack_from("<I", wav_bytes, 28)[0]
        data_size = struct.unpack_from("<I", wav_bytes, 40)[0]

        if byte_rate > 0:
            return data_size / byte_rate

        # Fallback: parse sample rate, channels, bits per sample
        sample_rate = struct.unpack_from("<I", wav_bytes, 24)[0]
        num_channels = struct.unpack_from("<H", wav_bytes, 22)[0]
        bits_per_sample = struct.unpack_from("<H", wav_bytes, 34)[0]

        if sample_rate > 0 and num_channels > 0 and bits_per_sample > 0:
            byte_rate_calc = sample_rate * num_channels * (bits_per_sample // 8)
            return data_size / byte_rate_calc if byte_rate_calc > 0 else 0.0

        return 0.0
    except Exception as e:
        logger.warning(f"Failed to parse WAV header for duration: {e}")
        return len(wav_bytes) / 176400.0


def get_wav_sample_rate(wav_bytes: bytes) -> Optional[int]:
    """Extract sample rate from WAV header bytes."""
    try:
        if len(wav_bytes) < 28:
            return None
        if wav_bytes[:4] != b"RIFF":
            return None
        return struct.unpack_from("<I", wav_bytes, 24)[0]
    except Exception:
        return None


def resolve_voice_profile(voice_profile: str) -> tuple[Optional[str], str]:
    """
    Resolve a voice profile name to (ref_audio_path_or_base64, ref_text).

    Returns:
        Tuple of (ref_audio, ref_text). ref_audio may be None if not available.
    """
    # Check file-based profiles first
    if VOICE_PROFILES_DIR and os.path.isdir(VOICE_PROFILES_DIR):
        profile_dir = Path(VOICE_PROFILES_DIR) / voice_profile
        if profile_dir.is_dir():
            # Look for .wav or .mp3 reference audio
            for ext in (".wav", ".mp3", ".flac", ".ogg"):
                audio_file = profile_dir / f"ref{ext}"
                if audio_file.exists():
                    text_file = profile_dir / "ref.txt"
                    ref_text = text_file.read_text().strip() if text_file.exists() else ""
                    logger.info(f"Loaded voice profile '{voice_profile}' from file: {audio_file}")
                    return str(audio_file), ref_text

    # Check built-in profiles
    if voice_profile in BUILTIN_VOICE_PROFILES:
        profile = BUILTIN_VOICE_PROFILES[voice_profile]
        return profile.get("ref_audio"), profile.get("ref_text", "")

    # Unknown profile — use default
    logger.warning(f"Unknown voice profile '{voice_profile}', using default")
    default = BUILTIN_VOICE_PROFILES["default"]
    return default.get("ref_audio"), default.get("ref_text", "")


def get_available_voices() -> list[VoiceProfile]:
    """Get list of all available voice profiles."""
    voices: list[VoiceProfile] = []

    # Add built-in profiles
    for name, profile in BUILTIN_VOICE_PROFILES.items():
        voices.append(
            VoiceProfile(
                name=name,
                ref_text=profile.get("ref_text", ""),
                has_ref_audio="ref_audio" in profile,
                source="builtin",
            )
        )

    # Add file-based profiles
    if VOICE_PROFILES_DIR and os.path.isdir(VOICE_PROFILES_DIR):
        profiles_dir = Path(VOICE_PROFILES_DIR)
        for entry in sorted(profiles_dir.iterdir()):
            if entry.is_dir():
                has_audio = any(
                    (entry / f"ref{ext}").exists() for ext in (".wav", ".mp3", ".flac", ".ogg")
                )
                text_file = entry / "ref.txt"
                ref_text = text_file.read_text().strip() if text_file.exists() else ""

                # Don't duplicate built-in names
                if not any(v.name == entry.name for v in voices):
                    voices.append(
                        VoiceProfile(
                            name=entry.name,
                            ref_text=ref_text,
                            has_ref_audio=has_audio,
                            source="file",
                        )
                    )

    return voices


async def check_gradio_available() -> bool:
    """Check if the F5-TTS Gradio API is reachable."""
    try:
        client = await get_http_client()
        resp = await client.get(f"{GRADIO_BASE_URL}/", timeout=5.0)
        return resp.status_code == 200
    except Exception:
        return False


async def check_cli_available() -> bool:
    """Check if f5-tts_infer CLI is available."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "f5-tts_infer",
            "--help",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=5.0)
        return proc.returncode == 0
    except Exception:
        return False


# ─── Core Synthesis: Gradio API ─────────────────────────────────────────────


async def synthesize_via_gradio(
    text: str,
    ref_audio: Optional[str],
    ref_text: str,
    speed: float,
) -> tuple[bytes, float, Optional[int]]:
    """
    Call the F5-TTS Gradio API at /api/tts.

    Gradio API format: POST /api/tts with {"data": [text, ref_audio, ref_text, speed]}

    Returns:
        Tuple of (wav_bytes, duration_seconds, sample_rate)
    """
    client = await get_http_client()

    # Build the Gradio payload
    # ref_audio can be: base64 data URL, file path, or empty string
    gradio_ref_audio = ref_audio or ""

    payload: dict[str, Any] = {
        "data": [
            text,
            gradio_ref_audio,
            ref_text,
            speed,
        ]
    }

    logger.info(f"Calling Gradio API: {GRADIO_BASE_URL}/api/tts")
    logger.debug(f"Gradio payload: text={text[:80]}..., ref_text={ref_text[:50]}, speed={speed}")

    resp = await client.post(f"{GRADIO_BASE_URL}/api/tts", json=payload)
    resp.raise_for_status()
    data = resp.json()

    # ── Parse Gradio response ──
    # Gradio can return audio in several formats:
    #   1. { data: ["data:audio/wav;base64,..."] }  — base64 data URL
    #   2. { data: ["/path/to/file.wav"] }           — file path on server
    #   3. { data: [{ "path": "...", "url": "/file=..." }] }  — Gradio file reference
    #   4. { data: ["<raw_base64>"] }                — raw base64 string

    if not data.get("data") or not isinstance(data["data"], list) or len(data["data"]) == 0:
        raise ValueError(f"Unexpected Gradio response format: {json.dumps(data)[:500]}")

    audio_result = data["data"][0]

    # Case 3: Gradio file reference object
    if isinstance(audio_result, dict):
        file_url = audio_result.get("url") or audio_result.get("path", "")
        if file_url:
            full_url = (
                file_url if file_url.startswith("http")
                else f"{GRADIO_BASE_URL}{'' if file_url.startswith('/') else '/'}{file_url}"
            )
            logger.info(f"Downloading audio from Gradio file endpoint: {full_url}")
            audio_resp = await client.get(full_url)
            audio_resp.raise_for_status()
            wav_bytes = audio_resp.content
            duration = estimate_wav_duration(wav_bytes)
            sample_rate = get_wav_sample_rate(wav_bytes)
            return wav_bytes, duration, sample_rate

        raise ValueError(f"Gradio returned dict without file URL: {audio_result}")

    if not isinstance(audio_result, str):
        raise ValueError(f"Unexpected audio result type: {type(audio_result)}")

    # Case 1: base64 data URL
    if audio_result.startswith("data:"):
        # Extract base64 portion after the comma
        base64_data = audio_result.split(",", 1)[1] if "," in audio_result else audio_result
        wav_bytes = base64.b64decode(base64_data)
        duration = estimate_wav_duration(wav_bytes)
        sample_rate = get_wav_sample_rate(wav_bytes)
        return wav_bytes, duration, sample_rate

    # Case 2: file path
    if audio_result.startswith("/") or audio_result.startswith("C:") or audio_result.startswith("\\\\"):
        if os.path.exists(audio_result):
            logger.info(f"Reading audio from server file path: {audio_result}")
            wav_bytes = Path(audio_result).read_bytes()
            duration = estimate_wav_duration(wav_bytes)
            sample_rate = get_wav_sample_rate(wav_bytes)
            return wav_bytes, duration, sample_rate

    # Case 4: raw base64
    try:
        wav_bytes = base64.b64decode(audio_result)
        # Validate it looks like audio
        if len(wav_bytes) > 44:
            duration = estimate_wav_duration(wav_bytes)
            sample_rate = get_wav_sample_rate(wav_bytes)
            return wav_bytes, duration, sample_rate
    except Exception:
        pass

    raise ValueError(f"Could not extract audio from Gradio response: {str(audio_result)[:200]}")


# ─── Core Synthesis: CLI Fallback ───────────────────────────────────────────


async def synthesize_via_cli(
    text: str,
    ref_audio_path: Optional[str],
    ref_text: str,
    speed: float,
) -> tuple[bytes, float, Optional[int]]:
    """
    Fall back to f5-tts_infer CLI when the Gradio API is unavailable.

    Returns:
        Tuple of (wav_bytes, duration_seconds, sample_rate)
    """
    with tempfile.TemporaryDirectory(prefix="f5tts_") as tmpdir:
        output_path = os.path.join(tmpdir, f"output_{uuid.uuid4().hex[:8]}.wav")

        cmd = [
            "f5-tts_infer",
            "--text", text,
            "--output", output_path,
            "--speed", str(speed),
        ]

        if ref_audio_path and os.path.exists(ref_audio_path):
            cmd.extend(["--ref_audio", ref_audio_path])
            if ref_text:
                cmd.extend(["--ref_text", ref_text])

        logger.info(f"Calling f5-tts_infer CLI: {' '.join(cmd[:6])}...")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=REQUEST_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            raise TimeoutError(f"f5-tts_infer timed out after {REQUEST_TIMEOUT}s")

        if proc.returncode != 0:
            error_msg = stderr.decode(errors="replace").strip()
            logger.error(f"f5-tts_infer failed (exit {proc.returncode}): {error_msg}")
            raise RuntimeError(f"f5-tts_infer failed: {error_msg[:500]}")

        if not os.path.exists(output_path):
            # Maybe the output was written somewhere else; check stdout
            logger.warning(f"Expected output not found at {output_path}")
            # Try to find any .wav file in tmpdir
            wav_files = list(Path(tmpdir).glob("*.wav"))
            if not wav_files:
                raise FileNotFoundError(f"f5-tts_infer produced no output file. stdout: {stdout.decode(errors='replace')[:500]}")
            output_path = str(wav_files[0])

        wav_bytes = Path(output_path).read_bytes()
        duration = estimate_wav_duration(wav_bytes)
        sample_rate = get_wav_sample_rate(wav_bytes)
        return wav_bytes, duration, sample_rate


# ─── Core Synthesis: Generate Silence Fallback ──────────────────────────────


def generate_silence_wav(duration_seconds: float = 1.0, sample_rate: int = 24000) -> bytes:
    """Generate a silent WAV file as a last-resort fallback."""
    num_samples = int(duration_seconds * sample_rate)
    silence = np.zeros(num_samples, dtype=np.float32)

    buffer = io.BytesIO()
    sf.write(buffer, silence, sample_rate, format="WAV", subtype="PCM_16")
    buffer.seek(0)
    return buffer.read()


# ─── Main Synthesis Orchestrator ────────────────────────────────────────────


async def synthesize(request: SynthesizeRequest) -> SynthesizeResponse:
    """
    Orchestrate TTS synthesis: try Gradio API first, fall back to CLI.
    """
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text must not be empty")

    # Resolve voice profile
    profile_ref_audio, profile_ref_text = resolve_voice_profile(request.voice_profile)

    # Request-level overrides take precedence
    ref_audio = request.ref_audio or profile_ref_audio
    ref_text = request.ref_text or profile_ref_text or request.voice_profile

    speed = request.speed
    wav_bytes: Optional[bytes] = None
    duration: float = 0.0
    sample_rate: Optional[int] = None
    engine_used: str = "f5-tts"

    # ── Strategy 1: Gradio API ──
    try:
        wav_bytes, duration, sample_rate = await synthesize_via_gradio(
            text=text,
            ref_audio=ref_audio,
            ref_text=ref_text,
            speed=speed,
        )
        logger.info(f"Synthesis via Gradio API: {duration:.2f}s audio, {len(wav_bytes)} bytes")
    except Exception as e:
        logger.warning(f"Gradio API failed: {e}")

        # ── Strategy 2: CLI fallback ──
        try:
            # For CLI, ref_audio needs to be a file path
            cli_ref_audio = None
            if ref_audio:
                if ref_audio.startswith("data:"):
                    # Decode base64 data URL to temp file
                    try:
                        base64_data = ref_audio.split(",", 1)[1]
                        audio_bytes = base64.b64decode(base64_data)
                        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, prefix="f5tts_ref_") as tf:
                            tf.write(audio_bytes)
                            cli_ref_audio = tf.name
                    except Exception as decode_err:
                        logger.warning(f"Failed to decode ref_audio for CLI: {decode_err}")
                elif os.path.exists(ref_audio):
                    cli_ref_audio = ref_audio

            wav_bytes, duration, sample_rate = await synthesize_via_cli(
                text=text,
                ref_audio_path=cli_ref_audio,
                ref_text=ref_text,
                speed=speed,
            )
            engine_used = "f5-tts-cli"
            logger.info(f"Synthesis via CLI fallback: {duration:.2f}s audio, {len(wav_bytes)} bytes")
        except Exception as cli_err:
            logger.error(f"CLI fallback also failed: {cli_err}")
            raise HTTPException(
                status_code=503,
                detail=(
                    f"F5-TTS synthesis failed. Gradio API error: {e}. "
                    f"CLI fallback error: {cli_err}. "
                    f"Ensure F5-TTS is running: f5-tts_webui --port 5000"
                ),
            )

    # Encode to base64
    audio_b64 = base64.b64encode(wav_bytes).decode("ascii")

    return SynthesizeResponse(
        audio=audio_b64,
        duration_seconds=round(duration, 2),
        engine=engine_used,
        sample_rate=sample_rate,
    )


# ─── API Endpoints ──────────────────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse, summary="Health check")
async def health_check():
    """Check the health of the F5-TTS wrapper and its dependencies."""
    gradio_ok = await check_gradio_available()
    cli_ok = await check_cli_available()

    return HealthResponse(
        status="ok",
        engine="f5-tts-wrapper",
        gradio_available=gradio_ok,
        gradio_url=GRADIO_BASE_URL,
        cli_available=cli_ok,
    )


@app.post("/synthesize", response_model=SynthesizeResponse, summary="Synthesize speech")
async def synthesize_speech(request: SynthesizeRequest):
    """
    Synthesize speech from text using F5-TTS.

    Tries the Gradio API first, then falls back to the f5-tts_infer CLI.
    Returns base64-encoded WAV audio.
    """
    start_time = time.monotonic()
    try:
        result = await synthesize(request)
        elapsed = time.monotonic() - start_time
        logger.info(
            f"Synthesis completed in {elapsed:.2f}s: "
            f"text={request.text[:50]}... voice={request.voice_profile} "
            f"duration={result.duration_seconds}s engine={result.engine}"
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        elapsed = time.monotonic() - start_time
        logger.error(f"Synthesis failed after {elapsed:.2f}s: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/voices", response_model=VoicesResponse, summary="List available voices")
async def list_voices():
    """List all available voice profiles."""
    voices = get_available_voices()
    return VoicesResponse(voices=voices, count=len(voices))


@app.get("/", include_in_schema=False)
async def root():
    """Redirect to docs."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/docs")


# ─── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting F5-TTS Wrapper on port {WRAPPER_PORT}")
    logger.info(f"Gradio API target: {GRADIO_BASE_URL}")
    uvicorn.run(
        "f5_tts_api:app",
        host="0.0.0.0",
        port=WRAPPER_PORT,
        log_level=LOG_LEVEL.lower(),
        access_log=True,
    )
