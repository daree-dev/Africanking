import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import deploy_contracts as deployment
from deploy_contracts import (
    cooperative_salts,
    salt_for,
    transaction_link,
    write_manifest,
)


class DeploymentHelpersTest(unittest.TestCase):
    def test_cooperative_salts_match_factory_preimage(self):
        cooperative_id = "sample-cooperative"
        salts = cooperative_salts(cooperative_id)
        encoded_id = cooperative_id.encode("utf-8")

        self.assertEqual(
            salts["energy_token"],
            hashlib.sha256(encoded_id + b"\x00").hexdigest(),
        )
        self.assertEqual(
            salts["energy_distribution"],
            hashlib.sha256(encoded_id + b"\x01").hexdigest(),
        )
        self.assertEqual(
            salts["community_governance"],
            hashlib.sha256(encoded_id + b"\x02").hexdigest(),
        )

    def test_deployment_salts_are_stable_and_separated(self):
        registry = salt_for("africanking/registry/workshop")
        factory = salt_for("africanking/factory/workshop")

        self.assertEqual(registry, salt_for("africanking/registry/workshop"))
        self.assertNotEqual(registry, factory)

    def test_transaction_link_contains_network_explorer_hash(self):
        tx_hash = "a" * 64

        self.assertEqual(
            transaction_link("upload", f"Transaction hash: {tx_hash}"),
            {
                "hash": tx_hash,
                "url": f"https://stellar.expert/explorer/testnet/tx/{tx_hash}",
            },
        )
        self.assertEqual(
            transaction_link("upload", f"Transaction submitted with hash: {tx_hash}")[
                "hash"
            ],
            tx_hash,
        )

    def test_manifest_is_valid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "deployment.json"
            write_manifest(path, {"network": "testnet"})

            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")), {"network": "testnet"}
            )

    def test_dry_run_reports_addresses_without_submitting_transactions(self):
        addresses = ["C" + letter * 55 for letter in "ABCDE"]
        commands = []

        def fake_run(command, *, cwd=deployment.ROOT):
            commands.append(command)
            if command[1:3] == ["contract", "id"]:
                return addresses.pop(0)
            return ""

        output = io.StringIO()
        with (
            patch.object(sys, "argv", ["deploy_contracts.py", "--dry-run"]),
            patch.object(deployment.shutil, "which", return_value="stellar"),
            patch.object(deployment, "run", side_effect=fake_run),
            patch.object(
                deployment,
                "wasm_hashes",
                return_value={name: "b" * 64 for name in deployment.WASM_MODULES},
            ),
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(deployment.main(), 0)

        result = json.loads(output.getvalue())
        self.assertTrue(result["dry_run"])
        self.assertEqual(len(result["plan"]["addresses"]), 5)
        self.assertEqual(result["plan"]["sample_cooperative"]["initial_members"], [])
        self.assertFalse(
            any("upload" in command or "deploy" in command for command in commands)
        )


if __name__ == "__main__":
    unittest.main()
