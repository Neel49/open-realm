#!/usr/bin/env python3
"""Open Realm Backend — Gemini AI + Direct Blender socket (Rodin/PolyHaven/Hunyuan/code)"""

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
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

GAME_DIR = Path(__file__).parent
ASSETS_DIR = GAME_DIR / "assets" / "generated"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

# Load .env
env_file = GAME_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.strip().split("=", 1)
            os.environ.setdefault(k, v)

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"
BLENDER_HOST = "localhost"
BLENDER_PORT = 9876

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
    body["generationConfig"] = {"temperature": 0.9, "maxOutputTokens": 2048}

    data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")

    try:
        with urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode("utf-8"))
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
    """Strip markdown fences from code output."""
    text = re.sub(r'^```python\s*', '', text.strip())
    text = re.sub(r'^```\s*', '', text.strip())
    text = re.sub(r'```\s*$', '', text.strip())
    return text


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
        result = blender_command("get_viewport_screenshot", timeout=10)
        if isinstance(result, dict) and result.get("image"):
            return result["image"]
        if isinstance(result, str):
            return result
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
# ASSET GENERATION — Multi-strategy with validation
# =====================================================================
def generate_asset_bg(job_id, description, output_path):
    """Background thread: generate 3D asset using best available method."""
    jobs[job_id]["status"] = "generating"
    abs_output = os.path.abspath(output_path)

    if not blender_connected():
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["result"] = "Blender not connected"
        print(f"  Asset {job_id}: FAILED — Blender not connected")
        return

    blender_clear()

    # Strategy 1: Try Hyper3D Rodin (AI 3D generation — best quality)
    if try_rodin(job_id, description, abs_output):
        return

    # Strategy 2: Try Hunyuan 3D (local API at localhost:8081)
    if try_hunyuan(job_id, description, abs_output):
        return

    # Strategy 3: Try Poly Haven (free pre-made models)
    if try_polyhaven(job_id, description, abs_output):
        return

    # Strategy 4: Gemini-generated Blender Python code with validation
    if try_gemini_code(job_id, description, abs_output):
        return

    # All strategies failed
    jobs[job_id]["status"] = "failed"
    jobs[job_id]["result"] = "All generation methods failed"
    print(f"  Asset {job_id}: FAILED — all strategies exhausted")


def try_rodin(job_id, description, output_path):
    """Try Hyper3D Rodin for AI 3D model generation."""
    print(f"  Asset {job_id}: Trying Hyper3D Rodin...")
    try:
        # Check if Rodin is available
        status = blender_command("get_hyper3d_status", timeout=10)
        if isinstance(status, dict) and status.get("error"):
            print(f"  Asset {job_id}: Rodin not available: {status['error']}")
            return False

        # Create job
        result = blender_command("create_rodin_job", {
            "text_prompt": description[:200]
        }, timeout=30)

        if isinstance(result, dict) and result.get("error"):
            print(f"  Asset {job_id}: Rodin job failed: {result['error']}")
            return False

        # Get identifiers — handle nested response format
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

        # Hunyuan local API is synchronous — returns GLB and imports directly
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


def try_gemini_code(job_id, description, output_path, max_attempts=3):
    """Generate Blender Python code via Gemini, execute, validate with screenshot."""
    print(f"  Asset {job_id}: Trying Gemini code generation...")
    blender_clear()

    for attempt in range(max_attempts):
        prompt = f"""Generate Blender Python code to create this 3D asset:

{description}

Requirements:
- LOW-POLY stylized geometry (simple but recognizable)
- Colorful Principled BSDF materials (make it visually interesting)
- Center at origin, reasonable scale (a building ~5-10 units tall, objects ~1-3 units)
- Keep vertex count under 5000
- import bpy at top
- NO export code, NO scene clearing
- Output ONLY Python code, no explanation"""

        if attempt > 0:
            blender_clear()
            # Simpler prompt for retry — focus on getting SOMETHING created
            prompt = f"""Create a simple low-poly 3D model in Blender for: {description}

Keep it VERY simple — just basic shapes (cubes, cylinders, planes) with colored materials.
Example pattern:
```
import bpy
bpy.ops.mesh.primitive_cube_add(size=4, location=(0, 0, 2))
obj = bpy.context.active_object
mat = bpy.data.materials.new(name="Mat1")
mat.use_nodes = True
mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.2, 0.2, 1)
obj.data.materials.append(mat)
```
Use ONLY bpy.ops.mesh.primitive_* calls. No complex geometry. Output ONLY Python code."""

        code = clean_code(call_gemini(prompt,
            system="You are a Blender Python expert. Output only valid bpy code. No markdown, no explanation.",
            timeout=30))

        print(f"  Asset {job_id}: Attempt {attempt+1}, executing {len(code)} chars...")

        try:
            blender_exec(code)
            # Verify objects were actually created
            scene = blender_command("get_scene_info", timeout=5)
            obj_count = scene.get("object_count", 0) if isinstance(scene, dict) else 0
            if obj_count == 0:
                print(f"  Asset {job_id}: Code ran but created 0 objects, retrying...")
                raise Exception("No objects created")
            print(f"  Asset {job_id}: Created {obj_count} objects")
        except Exception as e:
            print(f"  Asset {job_id}: Blender exec error: {e}")
            if attempt == max_attempts - 1:
                # Last attempt: simple fallback
                try:
                    blender_clear()
                    blender_exec("""
import bpy
import random
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
# Simple building fallback
bpy.ops.mesh.primitive_cube_add(size=4, location=(0, 0, 2))
obj = bpy.context.active_object
obj.scale = (2, 2, 2)
mat = bpy.data.materials.new(name="BuildingMat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (random.random(), random.random(), random.random(), 1)
obj.data.materials.append(mat)
bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 4.5, 2.1))
sign = bpy.context.active_object
sign_mat = bpy.data.materials.new(name="SignMat")
sign_mat.use_nodes = True
sign_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.1, 0.6, 0.9, 1)
sign.data.materials.append(sign_mat)
""")
                except Exception:
                    pass
            continue

        # Validate via screenshot
        screenshot = blender_screenshot()
        if screenshot and attempt < max_attempts - 1:
            validation = call_gemini(
                f"I asked Blender to create: '{description}'. Does this viewport screenshot show "
                f"something that reasonably matches? Reply with ONLY 'PASS' or 'FAIL: reason'.",
                image_b64=screenshot, timeout=15
            )
            print(f"  Asset {job_id}: Validation: {validation[:80]}")
            if validation.strip().startswith("PASS"):
                break
            # Otherwise loop will retry
        else:
            break

    # Export
    try:
        blender_export_glb(output_path)
    except Exception as e:
        print(f"  Asset {job_id}: Export error: {e}")

    if os.path.exists(output_path):
        file_size = os.path.getsize(output_path)
        if file_size > 500:  # Sanity check — real GLB with geometry is > 500 bytes
            jobs[job_id]["status"] = "done"
            jobs[job_id]["result"] = f"Generated via Gemini code ({file_size} bytes)"
            print(f"  Asset {job_id}: SUCCESS (Gemini code, {file_size}B)")
            return True

    print(f"  Asset {job_id}: Gemini code generation failed")
    return False


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
        full_system = f"{SYSTEM_CONTEXT}\n\n## Current Task: NPC Chat\n\n{system}"
        print(f"  Chat: {prompt[:80]}...")

        text = call_gemini(prompt, system=full_system, timeout=15)
        data = extract_json(text)
        if data:
            return data
        return {"dialogue": text[:500], "emotion": "neutral", "action": "none"}

    def handle_world_event(self, body):
        """World event via Gemini."""
        context = body.get('context', '')
        action = body.get('action', '')
        print(f"  World event: {action[:80]}...")

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
            "description": "DETAILED description for 3D modeling: specific geometry, colors, components, layout. E.g. 'A red brick McDonald's restaurant with golden arches sign on front, drive-through window on right side, flat roof with ventilation units, glass front door and windows'",
            "label": "display name"
        }}
    ],
    "effects": ["none"]
}}

Available types: spawn_building, spawn_object, spawn_npc, modify_area, teleport_player, weather_change
For spawn_building/spawn_object, the "description" MUST be detailed enough for a 3D modeler — include colors, shapes, size, distinctive features.
Keep world_changes to 1-2 items max."""

        text = call_gemini(prompt, system=system, timeout=20)
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
        print(f"  Asset queued: {job_id} — {description[:60]}...")

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
    port = 3000
    blender_ok = blender_connected()
    server = ThreadedHTTPServer(('localhost', port), GameServer)
    print(f"╔═══════════════════════════════════════════════╗")
    print(f"║   Open Realm — port {port}                       ║")
    print(f"║   http://localhost:{port}                        ║")
    print(f"║   AI: Gemini {GEMINI_MODEL:>20}          ║")
    print(f"║   Blender: {'CONNECTED' if blender_ok else 'NOT FOUND':>10} (:{BLENDER_PORT})           ║")
    print(f"║   Assets: Rodin → PolyHaven → Gemini+Code     ║")
    print(f"║   Key: {'SET' if GEMINI_API_KEY else 'MISSING':>7}                                ║")
    print(f"╚═══════════════════════════════════════════════╝")
    server.serve_forever()
