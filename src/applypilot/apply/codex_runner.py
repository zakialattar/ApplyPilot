"""Manual Codex runner for generated ApplyPilot prompts."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from applypilot.apply.chrome import BASE_CDP_PORT, reset_worker_dir
from applypilot.apply.launcher import build_codex_exec_command


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a generated ApplyPilot prompt through Codex.")
    parser.add_argument("--prompt-file", required=True, help="Path to the generated prompt file.")
    parser.add_argument("--model", default="gpt-5.4", help="Codex model name.")
    parser.add_argument("--worker-id", type=int, default=0, help="Worker id used for temp dirs.")
    parser.add_argument("--cdp-port", type=int, default=BASE_CDP_PORT, help="Chrome CDP port for Playwright MCP.")
    args = parser.parse_args()

    prompt_path = Path(args.prompt_file).expanduser().resolve()
    prompt_text = prompt_path.read_text(encoding="utf-8")

    worker_dir = reset_worker_dir(args.worker_id)
    cmd, env = build_codex_exec_command(
        model=args.model,
        worker_id=args.worker_id,
        cdp_port=args.cdp_port,
        worker_dir=worker_dir,
    )

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        env=env,
        cwd=str(worker_dir),
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    assert proc.stdin is not None
    proc.stdin.write(prompt_text)
    proc.stdin.close()
    raise SystemExit(proc.wait())


if __name__ == "__main__":
    main()
