#!/usr/bin/env python3
"""Open Realm Backend — Routes game AI through Claude Code CLI + Blender MCP"""

import http.server
import json
import subprocess
import os
import re
import uuid
import threading
from pathlib import Path

GAME_DIR = Path(__file__).parent
ASSETS_DIR = GAME_DIR / "assets" / "generated"
PROJECT_DIR = "/Users/neel.patel/Documents/extra/yc"  # Where .claude.json has blender MCP
CLAUDE_BIN = "/Users/neel.patel/.local/bin/claude"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

# Load CLAUDE_CONTEXT.md for injection into all prompts
CONTEXT_FILE = GAME_DIR / "CLAUDE_CONTEXT.md"
CLAUDE_CONTEXT = CONTEXT_FILE.read_text() if CONTEXT_FILE.exists() else ""

# Environment without CLAUDECODE to avoid nesting check
CLEAN_ENV = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

# In-flight asset generation jobs
jobs = {}


def run_claude(prompt, timeout=60):
    """Run claude -p with a prompt and return the text response."""
    try:
        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt],
            capture_output=True, text=True, timeout=timeout,
            env=CLEAN_ENV, cwd=PROJECT_DIR
        )
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return '{"error": "timeout", "dialogue": "Hmm, let me think about that..."}'
    except Exception as e:
        return f'{{"error": "{str(e)}", "dialogue": "Something went wrong."}}'


def extract_json(text):
    """Extract JSON object from text that may contain other content."""
    try:
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            return json.loads(match.group())
    except json.JSONDecodeError:
        pass
    return None


def generate_asset_bg(job_id, description, output_path):
    """Background thread: ask claude to create a Blender asset and export it."""
    jobs[job_id]["status"] = "generating"
    abs_output = os.path.abspath(output_path)
    prompt = f"""{CLAUDE_CONTEXT}

## Current Task: 3D Asset Generation

Create this asset: {description}

Steps:
1. Get scene info to confirm Blender is connected.
2. Clear the scene (select all, delete all).
3. Try Hyper3D Rodin first (generate_hyper3d_model_via_text with the description, poll with get_hyper3d_status, then import_generated_asset).
4. If Rodin fails or is unavailable, create the asset manually with execute_blender_code using LOW-POLY stylized geometry and colorful Principled BSDF materials.
5. Export the ENTIRE scene as GLB to exactly: {abs_output}

Use: bpy.ops.export_scene.gltf(filepath="{abs_output}", export_format='GLB', use_selection=False, export_apply=True, export_materials='EXPORT')

Actually create and export the geometry. Do NOT just describe what to do."""

    text = run_claude(prompt, timeout=180)
    success = os.path.exists(abs_output)
    jobs[job_id]["status"] = "done" if success else "failed"
    jobs[job_id]["result"] = text[:200]
    print(f"  Asset job {job_id}: {'SUCCESS' if success else 'FAILED'} ({abs_output})")


class GameServer(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        # Quieter logging
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

        if self.path == '/api/chat':
            result = self.handle_chat(body)
        elif self.path == '/api/world-event':
            result = self.handle_world_event(body)
        elif self.path == '/api/generate-asset':
            result = self.handle_generate_asset(body)
        elif self.path == '/api/asset-status':
            result = self.handle_asset_status(body)
        else:
            result = {"error": "Unknown endpoint"}

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def handle_chat(self, body):
        """NPC conversation — claude generates dialogue + optional actions."""
        prompt = body.get('prompt', '')
        system = body.get('system', '')
        full = f"{CLAUDE_CONTEXT}\n\n## Current Task: NPC Chat\n\n{system}\n\n{prompt}"
        print(f"  Chat request: {prompt[:80]}...")

        text = run_claude(full, timeout=45)
        data = extract_json(text)
        if data:
            return data

        # If no JSON, wrap the raw text
        return {"dialogue": text[:500], "emotion": "neutral", "action": "none"}

    def handle_world_event(self, body):
        """Major game event — claude decides what happens in the world."""
        context = body.get('context', '')
        action = body.get('action', '')
        print(f"  World event: {action[:80]}...")

        prompt = f"""{CLAUDE_CONTEXT}

## Current Task: World Event

CURRENT CONTEXT: {context}
PLAYER ACTION: {action}

Decide what should happen next. Be creative, dramatic, and fun.
Respond ONLY with valid JSON (no markdown, no backticks):
{{
    "narrative": "1-2 sentence description of what happens",
    "npc_dialogue": "what the NPC says, or null",
    "world_changes": [
        {{
            "type": "spawn_building",
            "description": "detailed description of what to create in Blender (geometry, colors, layout)",
            "label": "display name",
            "position": "nearby"
        }}
    ],
    "new_location": "name of area if changing location, or null",
    "effects": ["particle_burst", "screen_flash", "none"]
}}

Available world_change types: spawn_building, spawn_object, spawn_npc, modify_area, teleport_player, weather_change
For spawn_building/spawn_object, the "description" field should be detailed enough for a 3D modeler to create it in Blender.
Keep world_changes to 1-2 items max."""

        text = run_claude(prompt, timeout=60)
        data = extract_json(text)
        if data:
            return data

        return {
            "narrative": text[:300] if text else "The world shifts mysteriously...",
            "world_changes": [],
            "npc_dialogue": None,
            "effects": ["none"]
        }

    def handle_generate_asset(self, body):
        """Start async Blender asset generation via claude + MCP."""
        description = body.get('description', 'a simple cube')
        job_id = body.get('id', str(uuid.uuid4())[:8])
        output_path = str(ASSETS_DIR / f"{job_id}.glb")

        jobs[job_id] = {"status": "queued", "path": f"assets/generated/{job_id}.glb"}
        print(f"  Asset generation started: {job_id} — {description[:60]}...")

        thread = threading.Thread(
            target=generate_asset_bg,
            args=(job_id, description, output_path),
            daemon=True
        )
        thread.start()

        return {"job_id": job_id, "status": "queued"}

    def handle_asset_status(self, body):
        """Check status of an asset generation job."""
        job_id = body.get('job_id', '')
        job = jobs.get(job_id, {"status": "unknown"})
        return {"job_id": job_id, **job}


import socketserver

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Handle requests in separate threads."""
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    os.chdir(str(GAME_DIR))
    port = 3000
    server = ThreadedHTTPServer(('localhost', port), GameServer)
    print(f"╔══════════════════════════════════════════╗")
    print(f"║   Open Realm Backend — port {port}          ║")
    print(f"║   Game: http://localhost:{port}             ║")
    print(f"║   AI: Claude Code CLI                    ║")
    print(f"║   3D: Blender MCP                        ║")
    print(f"╚══════════════════════════════════════════╝")
    server.serve_forever()
