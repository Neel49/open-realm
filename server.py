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
import subprocess
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

    if not blender_connected():
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["result"] = "Blender not connected"
        print(f"  Asset {job_id}: FAILED -- Blender not connected")
        return

    blender_clear()

    print(f"  Asset {job_id}: Using Gemini code pipeline")
    if try_gemini_code(job_id, description, abs_output):
        return

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


def call_claude_cli(prompt, timeout=120):
    """Call Claude CLI (claude -p) for code generation."""
    try:
        result = subprocess.run(
            ['claude', '-p', prompt],
            capture_output=True, text=True, timeout=timeout,
            env={**os.environ, 'TERM': 'dumb'}
        )
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        print(f"  Claude CLI timed out after {timeout}s")
        return ""
    except Exception as e:
        print(f"  Claude CLI error: {e}")
        return ""


def try_gemini_code(job_id, description, output_path):
    """Generate Blender Python code via Claude CLI, execute in Blender, export GLB."""
    print(f"  Asset {job_id}: Generating code via Claude CLI...")
    blender_clear()

    prompt = f"""Generate Blender Python code to create this 3D model: "{description}"

Rules:
- import bpy at top
- Use bpy.ops.mesh.primitive_* for geometry (cube_add, cylinder_add, uv_sphere_add, plane_add, cone_add)
- Every mesh gets a material — set color BOTH ways for GLB export:
    mat = bpy.data.materials.new("X")
    mat.use_nodes = True
    mat.diffuse_color = (r,g,b,1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (r,g,b,1)
- Use BRIGHT, COLORFUL materials — no gray, no black
- For buildings: ~6 wide, 4 deep, 3 tall, front door opening (~2 wide, ~2.5 tall), interior floor, furniture/shelves, point light inside (energy=200), sign/awning outside
- NO bpy.ops.export_scene, NO bpy.ops.wm.save, NO bpy.ops.object.select_all(action='SELECT') followed by delete
- Output ONLY the Python code, no explanation, no markdown fences"""

    raw_response = call_claude_cli(prompt)

    if not raw_response or len(raw_response) < 50:
        print(f"  Asset {job_id}: Claude returned empty/short response, falling back to Gemini...")
        raw_response = call_gemini(prompt,
            system="Output ONLY Blender Python code. No markdown. No explanation.",
            timeout=90)

    if not raw_response or len(raw_response) < 50:
        print(f"  Asset {job_id}: No code generated")
        return False

    code = clean_code(raw_response)
    print(f"  Asset {job_id}: Got {len(code)} chars of code, executing in Blender...")

    try:
        blender_exec(code)
        scene_info = blender_command("get_scene_info", timeout=5)
        obj_count = scene_info.get("object_count", 0) if isinstance(scene_info, dict) else 0
        print(f"  Asset {job_id}: Created {obj_count} objects")
    except Exception as e:
        print(f"  Asset {job_id}: Blender exec error: {e}")

    try:
        blender_export_glb(output_path)
    except Exception as e:
        print(f"  Asset {job_id}: Export error: {e}")
        return False

    if os.path.exists(output_path):
        file_size = os.path.getsize(output_path)
        if file_size > 500:
            jobs[job_id]["status"] = "done"
            jobs[job_id]["result"] = f"Generated ({file_size} bytes)"
            print(f"  Asset {job_id}: SUCCESS ({file_size}B)")
            return True

    print(f"  Asset {job_id}: Export produced no usable file")
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

        if self.path == '/api/tts':
            self.handle_tts(body)
            return

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

    def handle_tts(self, body):
        """Text-to-speech via Gemini TTS model."""
        text = body.get('text', '')
        voice = body.get('voice', 'Kore')
        print(f"  TTS: voice={voice}, text={text[:60]}...")
        try:
            if not genai or not GEMINI_API_KEY:
                raise RuntimeError("Gemini not available")
            client = genai.Client(api_key=GEMINI_API_KEY)
            from google.genai import types
            response = client.models.generate_content(
                model="gemini-2.5-flash-preview-tts",
                contents=text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=voice,
                            )
                        )
                    ),
                ),
            )
            pcm_data = response.candidates[0].content.parts[0].inline_data.data
            import io
            buf = io.BytesIO()
            with wave.open(buf, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(24000)
                wf.writeframes(pcm_data)
            wav_bytes = buf.getvalue()
            self.send_response(200)
            self.send_header('Content-Type', 'audio/wav')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(wav_bytes)))
            self.end_headers()
            self.wfile.write(wav_bytes)
            print(f"  TTS: OK ({len(wav_bytes)} bytes)")
        except Exception as e:
            print(f"  TTS: Failed -- {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())


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
