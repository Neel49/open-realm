#!/usr/bin/env python3
"""
Open Realm Explorer Agent — A Claude-powered agent that plays the game,
explores the world, interacts with NPCs, triggers world events, and logs issues.

Runs in a loop: observe → decide → act → log.
Uses Chrome automation + JS injection to bypass pointer lock.
"""

import subprocess
import json
import os
import time
import sys
from pathlib import Path

GAME_DIR = Path(__file__).parent
CLAUDE_BIN = "/Users/neel.patel/.local/bin/claude"
CLEAN_ENV = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
LOG_FILE = GAME_DIR / "agent_log.jsonl"


def run_claude(prompt, timeout=120):
    """Run claude -p with browser tools available."""
    try:
        result = subprocess.run(
            [CLAUDE_BIN, "-p", prompt, "--allowedTools", "mcp__claude-in-chrome__*,Read,Write,Edit,Bash"],
            capture_output=True, text=True, timeout=timeout,
            env=CLEAN_ENV, cwd=str(GAME_DIR)
        )
        return result.stdout.strip()
    except subprocess.TimeoutExpired:
        return "TIMEOUT"
    except Exception as e:
        return f"ERROR: {e}"


def log_entry(entry):
    """Append a JSON log entry."""
    with open(LOG_FILE, "a") as f:
        entry["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        f.write(json.dumps(entry) + "\n")
    print(f"  [{entry['timestamp']}] {entry.get('type', '?')}: {entry.get('summary', '')[:100]}")


SETUP_PROMPT = """You are an automated game tester for "Open Realm", a 3D open-world browser game at http://localhost:3000.

FIRST: Use the Chrome browser tools to:
1. Call tabs_context_mcp to get current tabs
2. Navigate to http://localhost:3000
3. Take a screenshot to see the start screen
4. Click the "ENTER WORLD" button (center of screen, around coordinates 756, 436)
5. Wait 3 seconds
6. Take a screenshot to confirm the game loaded
7. Read console messages for any errors

If the game is loaded, inject this JavaScript to enable programmatic control:

```javascript
// Expose game control functions globally for the agent
window._agent = {
    moveForward: () => { document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyW', bubbles: true})); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyW', bubbles: true})), 500); },
    moveBack: () => { document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyS', bubbles: true})); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyS', bubbles: true})), 500); },
    moveLeft: () => { document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true})); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyA', bubbles: true})), 500); },
    moveRight: () => { document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyD', bubbles: true})); setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', {code: 'KeyD', bubbles: true})), 500); },
    interact: () => document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyE', bubbles: true})),
    grab: () => document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyG', bubbles: true})),
    vehicle: () => document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyV', bubbles: true})),
    escape: () => document.dispatchEvent(new KeyboardEvent('keydown', {code: 'Escape', bubbles: true})),
};
'Agent controls injected'
```

Report what you see: any errors, the game state, what's visible."""


EXPLORE_PROMPT_TEMPLATE = """You are an automated game tester for "Open Realm" running at http://localhost:3000.
The game is already loaded in Chrome. Your job is to explore and test ONE specific thing.

Previous findings: {previous}

YOUR TASK THIS ROUND: {task}

Steps:
1. Take a screenshot to see current game state
2. Read console errors
3. Use JavaScript to interact with the game. The game modules are ES modules so you need to access them differently.
   - To move the player, dispatch keyboard events OR directly modify player position via the import
   - To check game state, read the info bar text or inject JS to query scene objects
4. Take another screenshot after your action
5. Report your findings as JSON:
   {{"finding": "what you observed", "issue": "any bug or problem found, or null", "suggestion": "how to fix it, or null"}}

IMPORTANT: If you find a real bug or issue, describe it precisely with the error message or behavior."""


TASKS = [
    "Take a screenshot and describe what you see. Check console for any JS errors. Report the game state.",
    "Try to move the player forward using keyboard simulation. Check if movement works without pointer lock. If not, suggest a fix.",
    "Look for NPCs in the scene. Check if NPC labels are rendering. Try to get close to one and interact.",
    "Test the chat system: open the chat panel by simulating an E keypress near an NPC, type a message, see if Gemini responds.",
    "Check if vehicles are drivable. Look for a car, try pressing V near it.",
    "Test the world event system: talk to an NPC and ask them to build something. Check if the generating overlay appears.",
    "Examine an object by pressing E on it. Check if the examine panel shows AI-generated content.",
    "Check overall performance: are there any lag spikes, console warnings, memory issues?",
]


def main():
    print("=" * 60)
    print("Open Realm Explorer Agent")
    print("=" * 60)
    print(f"Log file: {LOG_FILE}")
    print()

    # Phase 1: Setup
    print("--- Phase 1: Game Setup ---")
    output = run_claude(SETUP_PROMPT, timeout=120)
    log_entry({"type": "setup", "summary": output[:500], "full": output[:2000]})

    # Phase 2: Explore
    findings = []
    for i, task in enumerate(TASKS):
        print(f"\n--- Round {i+1}/{len(TASKS)}: {task[:60]}... ---")
        previous = "; ".join(f.get("finding", "")[:80] for f in findings[-3:]) or "None yet"

        prompt = EXPLORE_PROMPT_TEMPLATE.format(previous=previous, task=task)
        output = run_claude(prompt, timeout=90)

        # Try to extract JSON finding
        finding = {"finding": output[:500], "issue": None, "suggestion": None}
        try:
            import re
            match = re.search(r'\{[\s\S]*?"finding"[\s\S]*?\}', output)
            if match:
                finding = json.loads(match.group())
        except:
            pass

        findings.append(finding)
        log_entry({"type": "explore", "round": i+1, "task": task, **finding})

        if finding.get("issue"):
            print(f"  ISSUE: {finding['issue'][:100]}")
            if finding.get("suggestion"):
                print(f"  FIX:   {finding['suggestion'][:100]}")

        time.sleep(2)

    # Summary
    print("\n" + "=" * 60)
    print("EXPLORATION SUMMARY")
    print("=" * 60)
    issues = [f for f in findings if f.get("issue")]
    print(f"Rounds completed: {len(findings)}")
    print(f"Issues found: {len(issues)}")
    for issue in issues:
        print(f"  - {issue['issue'][:100]}")
        if issue.get("suggestion"):
            print(f"    Fix: {issue['suggestion'][:100]}")

    log_entry({"type": "summary", "summary": f"{len(findings)} rounds, {len(issues)} issues",
               "issues": [i.get("issue") for i in issues]})


if __name__ == "__main__":
    main()
