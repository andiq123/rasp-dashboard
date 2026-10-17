import json
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch


apply = runpy.run_path(str(Path(__file__).with_name("cloudflare-routing.py")))["apply"]


def installed_rules():
    # iproute2 emits destination and prefix length separately on the Pi.
    return [
        {"priority": 20000 + index, "src": "all", "dst": network,
         "dstlen": 24, "ipproto": protocol, "dport": 7844, "table": "main"}
        for index, (network, protocol) in enumerate(
            (network, protocol)
            for network in ("198.41.192.0", "198.41.200.0")
            for protocol in ("tcp", "udp")
        )
    ]


class RoutingTests(unittest.TestCase):
    def test_start_is_idempotent_with_existing_pi_rules(self):
        with patch("subprocess.check_output", return_value=json.dumps(installed_rules())), \
                patch("subprocess.run") as run:
            apply("start")
            run.assert_not_called()

    def test_collision_refuses_all_mutations(self):
        rules = installed_rules()
        rules[-1]["dport"] = 443
        with patch("subprocess.check_output", return_value=json.dumps(rules)), \
                patch("subprocess.run") as run:
            with self.assertRaises(SystemExit):
                apply("start")
            run.assert_not_called()

    def test_stop_removes_only_owned_rules(self):
        rules = installed_rules() + [{"priority": 32765, "table": 51820}]
        with patch("subprocess.check_output", return_value=json.dumps(rules)), \
                patch("subprocess.run") as run:
            apply("stop")
            self.assertEqual(run.call_count, 4)
            for call in run.call_args_list:
                command = call.args[0]
                self.assertEqual(command[:4], ["ip", "-4", "rule", "del"])
                self.assertEqual(command[-4:], ["dport", "7844", "lookup", "main"])

    def test_start_adds_only_missing_rules(self):
        with patch("subprocess.check_output", return_value=json.dumps(installed_rules()[:3])), \
                patch("subprocess.run") as run:
            apply("start")
            run.assert_called_once_with(
                ["ip", "-4", "rule", "add", "pref", "20003", "to",
                 "198.41.200.0/24", "ipproto", "udp", "dport", "7844", "lookup", "main"],
                check=True,
            )


if __name__ == "__main__":
    unittest.main()
