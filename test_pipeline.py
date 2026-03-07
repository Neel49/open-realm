#!/usr/bin/env python3
"""Open Realm — Automated pipeline tester. Tests all API endpoints and asset generation."""

import json
import time
import sys
from urllib.request import Request, urlopen

BASE = "http://localhost:3000"

def post(endpoint, body):
    data = json.dumps(body).encode()
    req = Request(f"{BASE}/api/{endpoint}", data=data, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

def test(name, fn):
    try:
        result = fn()
        print(f"  PASS  {name}")
        return result
    except Exception as e:
        print(f"  FAIL  {name}: {e}")
        return None

print("=" * 60)
print("Open Realm Pipeline Test")
print("=" * 60)

# Test 1: Server is up
test("Server responds", lambda: urlopen(f"{BASE}/", timeout=5).read())

# Test 2: NPC profile generation (diverse)
profiles = []
for seed in [42, 999, 7777, 12345, 88888]:
    p = test(f"NPC profile (seed={seed})", lambda: post("chat", {
        "system": "You generate unique game NPC data. Every NPC should feel different. Respond ONLY with valid JSON.",
        "prompt": f"Seed: {seed}. Create a unique NPC. JSON: {{\"name\":\"...\",\"occupation\":\"...\",\"personality\":\"one sentence\",\"greeting\":\"short\"}}"
    }))
    if p and p.get("name"):
        profiles.append(p)
        print(f"         -> {p['name']} ({p.get('occupation', '?')})")

occupations = set(p.get("occupation", "") for p in profiles)
if len(occupations) >= 3:
    print(f"  PASS  NPC diversity: {len(occupations)} unique occupations")
else:
    print(f"  WARN  Low NPC diversity: {occupations}")

# Test 3: NPC chat with world_event trigger
chat = test("NPC chat (world_event trigger)", lambda: post("chat", {
    "system": "You are Chef Marco, an Italian pizza chef. If the player asks to do something, set action to 'world_event'. Respond ONLY with valid JSON: {\"dialogue\":\"...\",\"emotion\":\"...\",\"action\":\"none|world_event\",\"activity\":\"...\"}",
    "prompt": "Hey Marco, can you build me a pizza restaurant?"
}))
if chat:
    print(f"         -> dialogue: {chat.get('dialogue', '')[:80]}")
    print(f"         -> action: {chat.get('action')}, activity: {str(chat.get('activity', ''))[:60]}")
    if chat.get("action") == "world_event":
        print(f"  PASS  World event triggered correctly")
    else:
        print(f"  WARN  Expected world_event, got: {chat.get('action')}")

# Test 4: World event
event = test("World event resolution", lambda: post("world-event", {
    "context": "Player at (10, 20) talking to Chef Marco (pizza chef). Nearby: buildings, park, road.",
    "action": "Player said: 'Build me a pizza restaurant'. NPC agreed to: build a pizza place"
}))
if event:
    print(f"         -> narrative: {event.get('narrative', '')[:80]}")
    changes = event.get("world_changes", [])
    print(f"         -> {len(changes)} world changes")
    for c in changes:
        print(f"            - {c.get('type')}: {c.get('label')} ({str(c.get('description',''))[:50]}...)")

# Test 5: Object examination
exam = test("Object examination", lambda: post("chat", {
    "system": "You are a creative game narrator. Respond ONLY with valid JSON.",
    "prompt": "Player examines a rusty fire hydrant. Nearby: road, cars, buildings. JSON: {\"description\":\"...\",\"interactions\":[\"action1\",\"action2\"]}"
}))
if exam:
    print(f"         -> {exam.get('description', '')[:80]}")
    print(f"         -> interactions: {exam.get('interactions', [])}")

# Test 6: Asset generation (if Blender connected)
print("\n--- Asset Generation ---")
asset = test("Start asset job", lambda: post("generate-asset", {
    "description": "A small wooden market stall with a striped red and white awning, a counter, and shelves with goods",
    "id": "test_stall"
}))

if asset and asset.get("job_id"):
    job_id = asset["job_id"]
    print(f"         -> job_id: {job_id}, polling...")
    for i in range(40):
        time.sleep(5)
        status = post("asset-status", {"job_id": job_id})
        s = status.get("status")
        if s == "done":
            print(f"  PASS  Asset generated: {status.get('result', '')}")
            print(f"         -> path: {status.get('path')}")
            break
        elif s == "failed":
            print(f"  FAIL  Asset generation failed: {status.get('result', '')}")
            break
        else:
            if i % 6 == 0:
                print(f"         -> [{i*5}s] status: {s}")
    else:
        print(f"  FAIL  Asset generation timed out after 200s")

print("\n" + "=" * 60)
print("Tests complete.")
