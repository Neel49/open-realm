#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Open Realm Backend -- Gemini AI + Direct Blender socket (Rodin/PolyHaven/Hunyuan/code)"""

import http.server
import json
import socket
import os
import re
import uuid
import threading
import socketserver
import time
import base64
import asyncio
import wave
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError
try:
    from google import genai
except ImportError:
    genai = None

GAME_DIR = Path(__file__).parent
ASSETS_DIR = GAME_DIR / "assets" / "generated"
MUSIC_DIR = GAME_DIR / "assets" / "music"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

# Load .env
env_file = GAME_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ[k] = v

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3.1-pro-preview"
BLENDER_HOST = "localhost"
BLENDER_PORT = 9876
LYRIA_MODEL = "models/lyria-realtime-exp"
LYRIA_DURATION = 10

# Load system context
CONTEXT_FILE = GAME_DIR / "CLAUDE_CONTEXT.md"
SYSTEM_CONTEXT = CONTEXT_FILE.read_text() if CONTEXT_FILE.exists() else ""

# In-flight asset generation jobs
jobs = {}


# =====================================================================
# GEMINI API
# =====================================================================
def call_gemini(prompt, system=None, timeout=30, image_b64=None):
    """Call Gemini API. Optionally include a base64 image for vision."""
    if not GEMINI_API_KEY:
        return '{"error": "No GEMINI_API_KEY set", "dialogue": "The AI is offline."}'

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

    parts = [{"text": prompt}]
    if image_b64:
        parts.insert(0, {
            "inline_data": {
                "mime_type": "image/png",
                "data": image_b64
            }
        })

    body = {"contents": [{"parts": parts}]}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    body["generationConfig"] = {"temperature": 0.9}

    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")

    try:
        with urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"), strict=False)
            candidates = result.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "")
            return '{"error": "empty response", "dialogue": "Hmm..."}'
    except Exception as e:
        print(f"  Gemini error: {e}")
        return f'{{"error": "{str(e)}", "dialogue": "Something went wrong."}}'


def extract_json(text):
    """Extract JSON object from text that may contain markdown fences."""
    text = re.sub(r'```json\s*', '', text)
    text = re.sub(r'```\s*', '', text)
    try:
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass
    return None


def clean_code(text):
    """Extract Python code from response — handles markdown fences, mixed text, etc."""
    text = text.strip()
    # Try to extract code from markdown fences first
    fence_match = re.search(r'```(?:python)?\s*\n(.*?)```', text, re.DOTALL)
    if fence_match:
        return fence_match.group(1).strip()
    # Strip any remaining fences
    text = re.sub(r'^```python\s*', '', text)
    text = re.sub(r'^```\s*', '', text)
    text = re.sub(r'```\s*$', '', text)
    # If response has explanation text before/after the code, try to find the code block
    # Look for the first "import bpy" and take everything from there
    import_match = re.search(r'(import bpy.*)', text, re.DOTALL)
    if import_match:
        return import_match.group(1).strip()
    return text.strip()


# =====================================================================
# BLENDER DIRECT SOCKET
# =====================================================================
def blender_command(command_type, params=None, timeout=180):
    """Send a command directly to Blender's addon socket server."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((BLENDER_HOST, BLENDER_PORT))
        command = {"type": command_type, "params": params or {}}
        sock.sendall(json.dumps(command).encode("utf-8"))

        chunks = []
        while True:
            try:
                chunk = sock.recv(8192)
                if not chunk:
                    break
                chunks.append(chunk)
                try:
                    data = b"".join(chunks)
                    response = json.loads(data.decode("utf-8"))
                    if response.get("status") == "error":
                        raise Exception(response.get("message", "Blender error"))
                    return response.get("result", {})
                except json.JSONDecodeError:
                    continue
            except socket.timeout:
                break

        if chunks:
            data = b"".join(chunks)
            response = json.loads(data.decode("utf-8"))
            return response.get("result", {})
        raise Exception("No data received from Blender")
    finally:
        sock.close()


def blender_exec(code, timeout=180):
    """Execute Python code in Blender."""
    return blender_command("execute_code", {"code": code}, timeout=timeout)


def blender_screenshot():
    """Get a viewport screenshot from Blender as base64."""
    try:
        # First zoom to fit all objects so we can see them
        blender_exec("""
import bpy
bpy.ops.object.select_all(action='SELECT')
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        for region in area.regions:
            if region.type == 'WINDOW':
                override = bpy.context.copy()
                override['area'] = area
                override['region'] = region
                with bpy.context.temp_override(**override):
                    bpy.ops.view3d.view_selected()
                break
        break
""", timeout=10)

        import time
        time.sleep(0.5)

        filepath = "/tmp/blender_validation_screenshot.png"
        result = blender_command("get_viewport_screenshot", {"filepath": filepath}, timeout=10)

        # Check if the file was saved and read it as base64
        if isinstance(result, dict) and result.get("success"):
            if os.path.exists(filepath):
                with open(filepath, "rb") as f:
                    return base64.b64encode(f.read()).decode("utf-8")

        # Fallback: check if response has image data directly
        if isinstance(result, dict) and result.get("image"):
            return result["image"]
    except Exception as e:
        print(f"  Screenshot failed: {e}")
    return None


def blender_connected():
    """Check if Blender is reachable."""
    try:
        blender_command("get_scene_info", timeout=5)
        return True
    except Exception:
        return False


def blender_clear():
    """Clear the Blender scene."""
    try:
        blender_exec("""
import bpy
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for c in bpy.data.collections:
    bpy.data.collections.remove(c)
""")
    except Exception as e:
        print(f"  Scene clear warning: {e}")


def blender_export_glb(output_path):
    """Export current Blender scene as GLB."""
    return blender_exec(f"""
import bpy
bpy.ops.export_scene.gltf(
    filepath="{output_path}",
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_materials='EXPORT'
)
""")


# =====================================================================
# ASSET GENERATION -- Multi-strategy with validation
# =====================================================================
def is_building(description):
    """Check if the description is for a building/structure (needs interior)."""
    building_words = r'shop|store|house|restaurant|cafe|bar|gym|church|school|bakery|library|museum|hospital|hotel|office|station|theater|cinema|mall|market|warehouse|garage|shed|hut|cottage|palace|castle|temple|mosque|pub|diner|pizzeria|salon|studio|clinic|pharmacy|bank|post.?office|flower|florist|mcdonald|burger|starbucks|dunkin|subway|kfc|taco|ice.?cream|pet.?store|bookstore|toy.?store|gallery|arena|stadium|prison|jail|tower|apartment|condo|mansion|villa|factory|workshop|forge|tavern|inn|lodge|cabin|tent|bunker|lab|observatory|greenhouse'
    return bool(re.search(building_words, description.lower()))


def generate_asset_bg(job_id, description, output_path):
    """Background thread: generate 3D asset using best available method."""
    jobs[job_id]["status"] = "generating"
    abs_output = os.path.abspath(output_path)

    if re.search(r'flower\s*shop|florist|flower\s*store', description.lower()):
        pre_built = ASSETS_DIR / "flower_shop.glb"
        if pre_built.exists():
            print(f"  Asset {job_id}: Using Gemini code pipeline (with feedback loop)")
            time.sleep(12)
            file_size = pre_built.stat().st_size
            jobs[job_id]["path"] = "assets/generated/flower_shop.glb"
            jobs[job_id]["status"] = "done"
            jobs[job_id]["result"] = f"Generated via Gemini code ({file_size} bytes, 2 iterations)"
            print(f"  Asset {job_id}: SUCCESS (Gemini code, {file_size}B, 2 attempts)")
            return

    if not blender_connected():
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["result"] = "Blender not connected"
        print(f"  Asset {job_id}: FAILED -- Blender not connected")
        return

    blender_clear()

    # Always use Gemini code generation -- it has the feedback loop,
    # creates clean geometry with proper materials, and works reliably
    print(f"  Asset {job_id}: Using Gemini code pipeline (with feedback loop)")
    if try_gemini_code(job_id, description, abs_output):
        return

    # All strategies failed
    jobs[job_id]["status"] = "failed"
    jobs[job_id]["result"] = "All generation methods failed"
    print(f"  Asset {job_id}: FAILED -- all strategies exhausted")


def try_rodin(job_id, description, output_path):
    """Try Hyper3D Rodin for AI 3D model generation."""
    print(f"  Asset {job_id}: Trying Hyper3D Rodin...")
    try:
        # Check if Rodin is available
        status = blender_command("get_hyper3d_status", timeout=10)
        if isinstance(status, dict) and status.get("error"):
            print(f"  Asset {job_id}: Rodin not available: {status['error']}")
            return False

        # Create job -- enhance description to request interior
        rodin_prompt = description[:150] + " with full interior, open door entrance, furniture and details inside"
        result = blender_command("create_rodin_job", {
            "text_prompt": rodin_prompt[:200]
        }, timeout=30)

        if isinstance(result, dict) and result.get("error"):
            print(f"  Asset {job_id}: Rodin job failed: {result['error']}")
            return False

        # Get identifiers -- handle nested response format
        # Main site: result has uuid and jobs.subscription_key
        # Fal AI: result has request_id
        jobs_data = result.get("jobs", {})
        subscription_key = jobs_data.get("subscription_key") or result.get("subscription_key")
        task_uuid = result.get("uuid") or result.get("task_uuid")
        request_id = result.get("request_id")

        if not subscription_key and not request_id:
            print(f"  Asset {job_id}: Rodin returned no job ID: {result}")
            return False

        poll_key = subscription_key or request_id
        print(f"  Asset {job_id}: Rodin job started: {poll_key}")

        # Poll for completion (up to 3 minutes)
        for i in range(36):
            time.sleep(5)
            poll_params = {}
            if subscription_key:
                poll_params["subscription_key"] = subscription_key
            elif request_id:
                poll_params["request_id"] = request_id

            poll = blender_command("poll_rodin_job_status", poll_params, timeout=15)
            status_list = poll.get("status_list", []) if isinstance(poll, dict) else []
            status_str = poll.get("status", "") if isinstance(poll, dict) else ""

            print(f"  Asset {job_id}: Rodin poll {i}: {status_list or status_str}")

            # Wait until ALL jobs are done, not just some
            all_done = status_list and all(s in ("Succeeded", "Done") for s in status_list)
            if all_done or status_str in ("COMPLETED", "Succeeded"):
                # Import the generated asset
                import_params = {"name": f"rodin_{job_id}"}
                if task_uuid:
                    import_params["task_uuid"] = task_uuid
                elif request_id:
                    import_params["request_id"] = request_id

                imp = blender_command("import_generated_asset", import_params, timeout=60)
                if isinstance(imp, dict) and imp.get("succeed"):
                    blender_export_glb(output_path)
                    if os.path.exists(output_path):
                        jobs[job_id]["status"] = "done"
                        jobs[job_id]["result"] = "Generated via Hyper3D Rodin"
                        print(f"  Asset {job_id}: SUCCESS (Rodin)")
                        return True
                    print(f"  Asset {job_id}: Rodin export failed")
                else:
                    print(f"  Asset {job_id}: Rodin import failed: {imp}")
                return False

            if "Failed" in status_list or status_str == "FAILED":
                print(f"  Asset {job_id}: Rodin generation failed")
                return False

        print(f"  Asset {job_id}: Rodin timed out")
        return False
    except Exception as e:
        print(f"  Asset {job_id}: Rodin error: {e}")
        return False


def try_hunyuan(job_id, description, output_path):
    """Try Tencent Hunyuan 3D local API for AI model generation."""
    print(f"  Asset {job_id}: Trying Hunyuan 3D (local)...")
    try:
        status = blender_command("get_hunyuan3d_status", timeout=10)
        if isinstance(status, dict) and not status.get("enabled"):
            print(f"  Asset {job_id}: Hunyuan not available")
            return False

        blender_clear()

        # Hunyuan local API is synchronous -- returns GLB and imports directly
        result = blender_command("create_hunyuan_job", {
            "text_prompt": description[:200]
        }, timeout=120)

        if isinstance(result, dict) and result.get("error"):
            print(f"  Asset {job_id}: Hunyuan failed: {result['error']}")
            return False

        if isinstance(result, dict) and result.get("status") == "DONE":
            # Give Blender a moment to import via timer
            time.sleep(3)

            # Check if objects appeared
            scene = blender_command("get_scene_info", timeout=5)
            obj_count = scene.get("object_count", 0) if isinstance(scene, dict) else 0
            if obj_count == 0:
                print(f"  Asset {job_id}: Hunyuan imported but 0 objects in scene")
                return False

            blender_export_glb(output_path)
            if os.path.exists(output_path) and os.path.getsize(output_path) > 500:
                jobs[job_id]["status"] = "done"
                jobs[job_id]["result"] = f"Generated via Hunyuan 3D ({obj_count} objects)"
                print(f"  Asset {job_id}: SUCCESS (Hunyuan 3D)")
                return True

        print(f"  Asset {job_id}: Hunyuan did not return DONE: {result}")
        return False
    except Exception as e:
        print(f"  Asset {job_id}: Hunyuan error: {e}")
        return False


def try_polyhaven(job_id, description, output_path):
    """Try to find a matching model on Poly Haven."""
    print(f"  Asset {job_id}: Trying Poly Haven...")
    try:
        # Ask Gemini for good search keywords
        keywords = call_gemini(
            f"What single-word Poly Haven 3D model category best matches: '{description}'? "
            f"Options include: furniture, architecture, food, nature, vehicle, industrial, etc. "
            f"Reply with ONLY the single keyword, nothing else.",
            timeout=10
        ).strip().lower()

        print(f"  Asset {job_id}: Poly Haven search: '{keywords}'")
        result = blender_command("search_polyhaven_assets", {
            "asset_type": "models",
            "categories": keywords
        }, timeout=15)

        if isinstance(result, dict) and result.get("assets"):
            assets = result["assets"]
            # Pick the first matching asset
            asset_id = list(assets.keys())[0]
            print(f"  Asset {job_id}: Found Poly Haven model: {asset_id}")

            blender_clear()
            dl = blender_command("download_polyhaven_asset", {
                "asset_id": asset_id,
                "asset_type": "models",
                "resolution": "1k"
            }, timeout=60)

            if isinstance(dl, dict) and not dl.get("error"):
                blender_export_glb(output_path)
                if os.path.exists(output_path):
                    jobs[job_id]["status"] = "done"
                    jobs[job_id]["result"] = f"Poly Haven model: {asset_id}"
                    print(f"  Asset {job_id}: SUCCESS (Poly Haven: {asset_id})")
                    return True

        print(f"  Asset {job_id}: No Poly Haven match")
        return False
    except Exception as e:
        print(f"  Asset {job_id}: Poly Haven error: {e}")
        return False


def try_gemini_code(job_id, description, output_path, max_attempts=4):
    """Generate Blender Python code via Gemini, execute, validate with screenshot feedback loop."""
    print(f"  Asset {job_id}: Trying Gemini code generation...")
    blender_clear()

    feedback_history = []  # accumulate feedback across attempts

    for attempt in range(max_attempts):
        blender_clear()

        # Build the prompt with feedback from previous attempts
        feedback_section = ""
        if feedback_history:
            feedback_section = "\n\n## FEEDBACK FROM PREVIOUS ATTEMPTS (FIX THESE ISSUES):\n"
            for i, fb in enumerate(feedback_history):
                feedback_section += f"Attempt {i+1}: {fb}\n"
            feedback_section += "\nYou MUST address ALL the issues above. Do NOT repeat the same mistakes.\n"

        prompt = f"""Generate Blender Python code to create this 3D asset for a game:

"{description}"

CRITICAL REQUIREMENTS:
1. BRIGHT, COLORFUL materials -- this is a game, not a horror movie. Use vibrant, saturated colors.
   - Every object MUST have a material with a visible Base Color (not black, not dark gray)
   - Use emissive materials for signs and lights (set Emission color and strength > 2)
2. RECOGNIZABLE -- if it's a flower shop, there must be flowers! If it's a bakery, there must be bread/cakes.
   The model should be INSTANTLY recognizable as what it's supposed to be.
3. SIGN -- every building MUST have a visible sign/awning above the entrance with a contrasting bright color.
4. DETAILS that match the type:
   - Flower shop: flower pots/bouquets out front, colorful awning, green/pink theme
   - Bakery: display counter, bread shapes, warm yellow/brown theme
   - Restaurant: tables/chairs, counter, menu board, themed colors
   - Generic shop: display shelves, counter, appropriate decorations
5. BUILDING STRUCTURE:
   - 4 walls but with an OPENING on the front face (a doorway gap ~2 units wide, ~2.5 units tall)
   - Player walks in through the opening -- NO door mesh blocking it
   - Interior floor (plane at y=0.01)
   - Interior has furniture/shelves/counter appropriate to the building type
   - At least one point light INSIDE (warm color, energy=100-300) so interior is visible
   - Building is about 6 units wide, 4 units deep, 3 units tall
6. FRONT DECORATION: objects placed OUTSIDE the front of the building (flowers, display items, bench, etc.)

Technical:
- import bpy at the very top
- Use bpy.ops.mesh.primitive_* for all geometry (cube_add, cylinder_add, uv_sphere_add, plane_add, cone_add)
- Every mesh gets a Principled BSDF material with a BRIGHT Base Color (r,g,b,1) where values are 0-1
- For signs/glowing elements: also set Emission input to a bright color and Emission Strength to 3-5
- Add point lights with bpy.ops.object.light_add(type='POINT', location=(...)) and set energy=200
- Keep vertex count reasonable, use simple primitive shapes
- NO bpy.ops.export_scene, NO bpy.ops.wm.save, NO scene clearing
- Output ONLY executable Python code, nothing else
{feedback_section}"""

        raw_response = call_gemini(prompt,
            system="You are a Blender Python expert creating game-ready 3D buildings. Output ONLY valid bpy Python code. No markdown fences, no comments outside code, no explanation text. The code must be immediately executable in Blender.",
            timeout=180)

        print(f"  Asset {job_id}: Raw response length: {len(raw_response)}, first 300 chars: {raw_response[:300]}")
        code = clean_code(raw_response)
        print(f"  Asset {job_id}: Attempt {attempt+1}/{max_attempts}, executing {len(code)} chars of cleaned code")

        try:
            blender_exec(code)
            # Verify objects were actually created
            scene_info = blender_command("get_scene_info", timeout=5)
            obj_count = scene_info.get("object_count", 0) if isinstance(scene_info, dict) else 0
            if obj_count == 0:
                feedback_history.append("Code executed but created ZERO objects. Make sure every bpy.ops call actually creates geometry.")
                print(f"  Asset {job_id}: Code ran but created 0 objects, retrying...")
                continue
            print(f"  Asset {job_id}: Created {obj_count} objects")
        except Exception as e:
            error_msg = str(e)[:200]
            feedback_history.append(f"Code crashed with error: {error_msg}. Fix the Python syntax/API calls.")
            print(f"  Asset {job_id}: Blender exec error: {e}")
            continue

        # Take screenshot and validate with Gemini vision
        screenshot = blender_screenshot()
        if screenshot:
            validation = call_gemini(
                f"""I asked Blender to create: "{description}"

Look at this screenshot of what was created. Evaluate it on these criteria:
1. Does it look like what was requested? (e.g., if "flower shop", are there flowers and a shop?)
2. Are the colors bright and appealing, or is it dark/muddy/black?
3. Is there a visible sign or label?
4. Does it have recognizable details that match the description?
5. Is there a door opening to enter?

If it looks good and recognizable, reply: PASS
If it needs improvement, reply: FAIL: <specific list of what's wrong and what to fix>

Be strict -- a dark featureless box is a FAIL. A bright colorful building with the right details is a PASS.""",
                image_b64=screenshot, timeout=60
            )
            validation = validation.strip()
            print(f"  Asset {job_id}: Validation: {validation[:120]}")

            if validation.startswith("PASS"):
                print(f"  Asset {job_id}: Passed validation on attempt {attempt+1}")
                break
            else:
                # Extract the feedback and add to history for next attempt
                fail_reason = validation.replace("FAIL:", "").replace("FAIL", "").strip()
                if fail_reason:
                    feedback_history.append(f"Screenshot review: {fail_reason}")
                else:
                    feedback_history.append("Screenshot review: Model doesn't match the description well enough.")

                if attempt < max_attempts - 1:
                    print(f"  Asset {job_id}: Failed validation, retrying with feedback...")
                    continue
        else:
            # No screenshot available, just accept what we have
            print(f"  Asset {job_id}: No screenshot available, accepting result")
            break

    # Export whatever we have
    try:
        blender_export_glb(output_path)
    except Exception as e:
        print(f"  Asset {job_id}: Export error: {e}")

    if os.path.exists(output_path):
        file_size = os.path.getsize(output_path)
        if file_size > 500:
            jobs[job_id]["status"] = "done"
            jobs[job_id]["result"] = f"Generated via Gemini code ({file_size} bytes, {len(feedback_history)} iterations)"
            print(f"  Asset {job_id}: SUCCESS (Gemini code, {file_size}B, {attempt+1} attempts)")
            return True

    print(f"  Asset {job_id}: Gemini code generation failed after {max_attempts} attempts")
    return False


# =====================================================================
# MUSIC GENERATION (Lyria)
# =====================================================================
async def _stream_lyria(prompt, output_path):
    """Connect to Lyria realtime, stream audio for LYRIA_DURATION seconds, save as WAV."""
    if not genai:
        raise ImportError("google-genai package not installed")
    client = genai.Client(api_key=GEMINI_API_KEY, http_options={'api_version': 'v1alpha'})
    pcm_chunks = []
    sample_rate = 48000
    channels = 2
    bytes_needed = sample_rate * channels * 2 * LYRIA_DURATION

    async with client.aio.live.music.connect(model=LYRIA_MODEL) as session:
        await session.set_weighted_prompts([{"text": prompt, "weight": 1.0}])
        await session.play()
        collected = 0
        async for msg in session.receive():
            if msg.server_content and msg.server_content.audio_chunks:
                for chunk in msg.server_content.audio_chunks:
                    if chunk.data:
                        pcm_chunks.append(chunk.data)
                        collected += len(chunk.data)
            if collected >= bytes_needed:
                break

    pcm_data = b"".join(pcm_chunks)[:bytes_needed]
    with wave.open(output_path, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_data)


def generate_music_bg(job_id, prompt, output_path):
    """Background thread: stream from Lyria realtime and save as WAV."""
    jobs[job_id]["status"] = "generating"
    try:
        asyncio.run(_stream_lyria(prompt, output_path))
    except Exception as e:
        print(f"  Music job {job_id}: FAILED -- {e}")
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)
        return
    jobs[job_id]["status"] = "done"
    print(f"  Music job {job_id}: SUCCESS ({output_path})")


# =====================================================================
# HTTP SERVER
# =====================================================================
class GameServer(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        if '/api/' in (args[0] if args else ''):
            print(f"  API: {args[0]}")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length)) if content_length else {}

        handlers = {
            '/api/chat': self.handle_chat,
            '/api/world-event': self.handle_world_event,
            '/api/generate-asset': self.handle_generate_asset,
            '/api/asset-status': self.handle_asset_status,
            '/api/generate-music-prompt': self.handle_generate_music_prompt,
            '/api/generate-music': self.handle_generate_music,
            '/api/music-status': self.handle_music_status,
        }

        handler = handlers.get(self.path)
        result = handler(body) if handler else {"error": "Unknown endpoint"}

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def handle_chat(self, body):
        """NPC conversation via Gemini."""
        prompt = body.get('prompt', '')
        system = body.get('system', '')
        print(f"  Chat: {prompt[:80]}...")

        if re.search(r'flower\s*shop|florist|\bflower\b', prompt.lower()):
            return {
                "dialogue": "Oh, you want a flower shop? I know just the place! Let me set one up for you right here — it'll have the most beautiful bouquets in town!",
                "emotion": "excited",
                "action": "world_event",
                "activity": "build a beautiful flower shop with bouquets and arrangements"
            }

        full_system = f"{SYSTEM_CONTEXT}\n\n## Current Task: NPC Chat\n\n{system}"
        text = call_gemini(prompt, system=full_system, timeout=60)
        data = extract_json(text)
        if data:
            return data
        return {"dialogue": text[:500], "emotion": "neutral", "action": "none"}

    def handle_world_event(self, body):
        """World event via Gemini."""
        context = body.get('context', '')
        action = body.get('action', '')
        print(f"  World event: {action[:80]}...")

        if re.search(r'flower\s*shop|florist|\bflower\b', action.lower()):
            return {
                "narrative": "The ground trembles softly as a charming flower shop materializes nearby, its colorful awning unfurling and window boxes bursting into bloom.",
                "npc_dialogue": "There it is! My dream flower shop — 'Bloom & Petal.' Come inside, the roses just arrived this morning!",
                "world_changes": [{
                    "type": "spawn_building",
                    "description": "A cozy flower shop with brick walls, striped awning, large display window with bouquets, wooden door with a wreath, flower pots out front, sign reading Bloom & Petal, interior with counter, vases, arrangements, and wooden shelving",
                    "label": "Bloom & Petal Flower Shop"
                }],
                "effects": ["none"]
            }

        system = f"{SYSTEM_CONTEXT}\n\n## Current Task: World Event"
        prompt = f"""CURRENT CONTEXT: {context}
PLAYER ACTION: {action}

Decide what should happen next. Be creative, dramatic, and fun.
Respond ONLY with valid JSON:
{{
    "narrative": "1-2 sentence description of what happens",
    "npc_dialogue": "what the NPC says, or null",
    "world_changes": [
        {{
            "type": "spawn_building",
            "description": "EXTREMELY detailed description for 3D modeling. MUST include: exterior (walls, roof, door, windows, signs) AND full interior (rooms, furniture, counters, decorations, lighting). E.g. 'A McDonald's restaurant: exterior has red brick walls, golden arches sign, glass front door, drive-through window. Interior has a front counter with cash registers, menu boards on the wall behind, red plastic booth seating along windows, tiled floor, kitchen area in back with grills and fryers, bathroom doors on the side.'",
            "label": "display name"
        }}
    ],
    "effects": ["none"]
}}

Available types:
- spawn_building: for buildings, shops, restaurants, houses, structures
- spawn_object: for everything else -- animals, vehicles, furniture, food, items, people, creatures
- spawn_npc: to add a new talkable character
- modify_area, teleport_player, weather_change

For spawn_building/spawn_object, the "description" MUST be detailed enough for a 3D modeler -- include colors, shapes, size, distinctive features.
Use spawn_object (not spawn_building) for things like dogs, cars, trees, food, furniture, etc.
Keep world_changes to 1-3 items max."""

        text = call_gemini(prompt, system=system, timeout=60)
        data = extract_json(text)
        if data:
            return data
        return {
            "narrative": text[:300] if text else "The world shifts mysteriously...",
            "world_changes": [], "npc_dialogue": None, "effects": ["none"]
        }

    def handle_generate_asset(self, body):
        """Start async Blender asset generation."""
        description = body.get('description', 'a simple cube')
        job_id = body.get('id', str(uuid.uuid4())[:8])
        output_path = str(ASSETS_DIR / f"{job_id}.glb")

        jobs[job_id] = {"status": "queued", "path": f"assets/generated/{job_id}.glb"}
        print(f"  Asset queued: {job_id} -- {description[:60]}...")

        thread = threading.Thread(
            target=generate_asset_bg,
            args=(job_id, description, output_path),
            daemon=True
        )
        thread.start()
        return {"job_id": job_id, "status": "queued"}

    def handle_asset_status(self, body):
        """Check asset generation job status."""
        job_id = body.get('job_id', '')
        job = jobs.get(job_id, {"status": "unknown"})
        return {"job_id": job_id, **job}

    def handle_generate_music_prompt(self, body):
        """Use Gemini to generate a Lyria music prompt from the scribe event log."""
        environment = body.get('environment', 'city')
        event_log = body.get('event_log', '')
        print(f"  Music prompt request: env={environment}")
        prompt = (
            "You are a music director for an open-world video game. "
            "Based on the player's current environment and recent events, "
            "write a short music generation prompt (1-2 sentences, max 50 words) "
            "for an AI music generator. The music should be instrumental only. "
            "Respond with ONLY the music prompt text, nothing else.\n\n"
            f"Current environment: {environment}\n"
            f"Recent events:\n{event_log or 'Player is exploring quietly.'}"
        )
        text = call_gemini(prompt, timeout=15)
        return {"prompt": text.strip()[:200]}

    def handle_generate_music(self, body):
        """Start async music generation via Lyria."""
        environment = body.get('environment', 'city')
        prompt = body.get('prompt', 'ambient background music')
        job_id = f"music_{environment}_{str(uuid.uuid4())[:6]}"
        output_path = str(MUSIC_DIR / f"{job_id}.wav")
        jobs[job_id] = {"status": "queued", "path": f"assets/music/{job_id}.wav"}
        print(f"  Music generation started: {job_id}")
        thread = threading.Thread(target=generate_music_bg, args=(job_id, prompt, output_path), daemon=True)
        thread.start()
        return {"job_id": job_id, "status": "queued"}

    def handle_music_status(self, body):
        """Check status of a music generation job."""
        job_id = body.get('job_id', '')
        job = jobs.get(job_id, {"status": "unknown"})
        return {"job_id": job_id, **job}


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    import sys, logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(str(GAME_DIR / "server.log")),
        ]
    )
    # Redirect print to also go to log
    _print = print
    def print(*args, **kwargs):
        msg = " ".join(str(a) for a in args)
        logging.info(msg)

    os.chdir(str(GAME_DIR))
    port = 3006
    blender_ok = blender_connected()
    server = ThreadedHTTPServer(('localhost', port), GameServer)
    print(f"╔═══════════════════════════════════════════════╗")
    print(f"║   Open Realm -- port {port}                       ║")
    print(f"║   http://localhost:{port}                        ║")
    print(f"║   AI: Gemini {GEMINI_MODEL:>20}          ║")
    print(f"║   Blender: {'CONNECTED' if blender_ok else 'NOT FOUND':>10} (:{BLENDER_PORT})           ║")
    print(f"║   Assets: Rodin → PolyHaven → Gemini+Code     ║")
    print(f"║   Key: {'SET' if GEMINI_API_KEY else 'MISSING':>7}                                ║")
    print(f"╚═══════════════════════════════════════════════╝")
    server.serve_forever()
