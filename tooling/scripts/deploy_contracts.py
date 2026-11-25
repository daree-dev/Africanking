#!/usr/bin/env python3
"""Build and deploy the Africanking cooperative contracts to Stellar Testnet."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence


ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "apps" / "contracts"
WASM_DIR = CONTRACTS / "target" / "wasm32v1-none" / "release"
NETWORK = "testnet"
EXPLORER = "https://stellar.expert/explorer/testnet"
CONTRACT_ID_RE = re.compile(r"\bC[A-Z2-7]{55}\b")
TX_HASH_RE = re.compile(
    r"(?:transaction|tx)[^\r\n]*?\bhash\s*[:=]\s*([0-9a-f]{64})",
    re.IGNORECASE,
)

WASM_MODULES = {
    "energy_token": "energy_token.wasm",
    "energy_distribution": "energy_distribution.wasm",
    "community_governance": "community_governance.wasm",
    "cooperative_registry": "cooperative_registry.wasm",
    "cooperative_factory": "cooperative_factory.wasm",
}


class DeploymentError(RuntimeError):
    pass


def run(command: Sequence[str], *, cwd: Path = ROOT) -> str:
    result = subprocess.run(
        list(command),
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    output = result.stdout.strip()
    if output:
        print(output)
    if result.returncode:
        raise DeploymentError(
            f"Command failed with exit code {result.returncode}: {' '.join(command)}"
        )
    return output


def contract_id(source: str, salt: str) -> str:
    output = run(
        [
            "stellar",
            "contract",
            "id",
            "wasm",
            "--source-account",
            source,
            "--salt",
            salt,
            "--network",
            NETWORK,
        ]
    )
    matches = CONTRACT_ID_RE.findall(output)
    if not matches:
        raise DeploymentError(f"Stellar CLI did not return a contract ID: {output}")
    return matches[-1]


def transaction_link(label: str, output: str) -> dict[str, str]:
    matches = TX_HASH_RE.findall(output)
    if not matches:
        raise DeploymentError(
            f"Could not find the transaction hash for {label} in Stellar CLI output."
        )
    tx_hash = matches[-1].lower()
    return {
        "hash": tx_hash,
        "url": f"{EXPLORER}/tx/{tx_hash}",
    }


def salt_for(label: str) -> str:
    return hashlib.sha256(label.encode("utf-8")).hexdigest()


def cooperative_salts(cooperative_id: str) -> dict[str, str]:
    base = cooperative_id.encode("utf-8")
    return {
        "energy_token": hashlib.sha256(base + b"\x00").hexdigest(),
        "energy_distribution": hashlib.sha256(base + b"\x01").hexdigest(),
        "community_governance": hashlib.sha256(base + b"\x02").hexdigest(),
    }


def wasm_hashes() -> dict[str, str]:
    hashes = {}
    for name, filename in WASM_MODULES.items():
        path = WASM_DIR / filename
        if not path.is_file():
            raise DeploymentError(f"Expected compiled WASM not found: {path}")
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as temporary:
        json.dump(manifest, temporary, indent=2)
        temporary.write("\n")
        temp_path = Path(temporary.name)
    temp_path.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        default=os.environ.get("STELLAR_SOURCE", "deployer"),
        help="Stellar CLI identity alias in secure local/CI storage "
        "(default: STELLAR_SOURCE or deployer)",
    )
    parser.add_argument(
        "--deployment-id",
        default="sample-testnet",
        help="Unique ID used to derive registry/factory addresses; use a new value "
        "for each deployment (default: sample-testnet)",
    )
    parser.add_argument(
        "--cooperative-id",
        default="sample-cooperative",
        help="Cooperative identifier (default: sample-cooperative)",
    )
    parser.add_argument("--token-name", default="Sample Cooperative Energy")
    parser.add_argument("--token-symbol", default="SCE")
    parser.add_argument(
        "--manifest",
        type=Path,
        help="Manifest path (default: deployments/testnet/<deployment-id>.json)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build and print deterministic addresses/parameters without submitting transactions",
    )
    args = parser.parse_args()
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}", args.deployment_id):
        parser.error(
            "--deployment-id must be 1-64 letters, digits, dots, underscores or hyphens"
        )
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}", args.cooperative_id):
        parser.error(
            "--cooperative-id must be 1-64 letters, digits, dots, underscores or hyphens"
        )
    if not args.token_name.strip() or len(args.token_name) > 32:
        parser.error("--token-name must contain 1-32 characters")
    if not re.fullmatch(r"[A-Za-z0-9]{1,12}", args.token_symbol):
        parser.error("--token-symbol must contain 1-12 alphanumeric characters")
    return args


def main() -> int:
    args = parse_args()
    if not shutil.which("stellar"):
        raise DeploymentError("Install Stellar CLI and ensure `stellar` is on PATH.")
    if not args.dry_run and not args.source:
        raise DeploymentError("Set STELLAR_SOURCE to a securely configured Stellar CLI identity.")

    run(
        [
            "stellar",
            "contract",
            "build",
            "--manifest-path",
            str(CONTRACTS / "Cargo.toml"),
            "--locked",
        ]
    )
    hashes = wasm_hashes()
    registry_salt = salt_for(f"africanking/registry/{args.deployment_id}")
    factory_salt = salt_for(f"africanking/factory/{args.deployment_id}")
    registry_id = contract_id(args.source, registry_salt)
    factory_id = contract_id(args.source, factory_salt)
    child_salts = cooperative_salts(args.cooperative_id)
    child_ids = {
        name: contract_id(factory_id, salt) for name, salt in child_salts.items()
    }

    params = {
        "admin": args.source,
        "cooperative_id": args.cooperative_id,
        "token_name": args.token_name,
        "token_symbol": args.token_symbol,
        "required_approvals": 1,
        "initial_members": [],
    }
    plan = {
        "network": NETWORK,
        "source": args.source,
        "deployment_id": args.deployment_id,
        "addresses": {
            "cooperative_registry": registry_id,
            "cooperative_factory": factory_id,
            **child_ids,
        },
        "salts": {
            "cooperative_registry": registry_salt,
            "cooperative_factory": factory_salt,
            **child_salts,
        },
        "wasm_hashes": hashes,
        "sample_cooperative": params,
    }
    print(json.dumps({"dry_run": args.dry_run, "plan": plan}, indent=2))
    if args.dry_run:
        return 0

    manifest_path = args.manifest or (
        ROOT / "deployments" / NETWORK / f"{args.deployment_id}.json"
    )
    if manifest_path.exists():
        raise DeploymentError(
            f"Manifest already exists: {manifest_path}. Choose a new deployment ID "
            "or inspect the existing deployment before proceeding."
        )

    transaction_links: dict[str, dict[str, str]] = {}
    manifest = {
        **plan,
        "status": "in_progress",
        "transactions": transaction_links,
        "explorer": EXPLORER,
    }
    write_manifest(manifest_path, manifest)

    def record_transaction(label: str, output: str) -> None:
        transaction_links[label] = transaction_link(label, output)
        write_manifest(manifest_path, manifest)

    for name in ("energy_token", "energy_distribution", "community_governance"):
        output = run(
            [
                "stellar",
                "contract",
                "upload",
                "--wasm",
                str(WASM_DIR / WASM_MODULES[name]),
                "--source-account",
                args.source,
                "--network",
                NETWORK,
            ]
        )
        record_transaction(f"upload_{name}", output)

    output = run(
        [
            "stellar",
            "contract",
            "deploy",
            "--wasm",
            str(WASM_DIR / WASM_MODULES["cooperative_registry"]),
            "--source-account",
            args.source,
            "--network",
            NETWORK,
            "--salt",
            registry_salt,
            "--",
            "--admin",
            args.source,
        ]
    )
    record_transaction("deploy_cooperative_registry", output)

    output = run(
        [
            "stellar",
            "contract",
            "deploy",
            "--wasm",
            str(WASM_DIR / WASM_MODULES["cooperative_factory"]),
            "--source-account",
            args.source,
            "--network",
            NETWORK,
            "--salt",
            factory_salt,
            "--",
            "--admin",
            args.source,
            "--registry",
            registry_id,
        ]
    )
    record_transaction("deploy_cooperative_factory", output)

    output = run(
        [
            "stellar",
            "contract",
            "invoke",
            "--contract-id",
            registry_id,
            "--source-account",
            args.source,
            "--network",
            NETWORK,
            "--",
            "set_factory",
            "--factory",
            factory_id,
        ]
    )
    record_transaction("initialize_registry_factory", output)

    output = run(
        [
            "stellar",
            "contract",
            "invoke",
            "--contract-id",
            factory_id,
            "--source-account",
            args.source,
            "--network",
            NETWORK,
            "--",
            "set_wasm_hashes",
            "--token-wasm-hash",
            hashes["energy_token"],
            "--distribution-wasm-hash",
            hashes["energy_distribution"],
            "--governance-wasm-hash",
            hashes["community_governance"],
        ]
    )
    record_transaction("approve_wasm_hashes", output)

    output = run(
        [
            "stellar",
            "contract",
            "invoke",
            "--contract-id",
            factory_id,
            "--source-account",
            args.source,
            "--network",
            NETWORK,
            "--",
            "deploy_cooperative",
            "--cooperative-id",
            args.cooperative_id,
            "--admin",
            args.source,
            "--token-name",
            args.token_name,
            "--token-symbol",
            args.token_symbol,
            "--initial-members",
            "[]",
            "--required-approvals",
            "1",
        ]
    )
    record_transaction("deploy_sample_cooperative", output)
    manifest["status"] = "complete"
    manifest["deployed_at"] = datetime.now(timezone.utc).isoformat()
    write_manifest(manifest_path, manifest)
    print(f"Deployment manifest written to {manifest_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DeploymentError as error:
        print(f"Deployment failed: {error}", file=sys.stderr)
        raise SystemExit(1)
