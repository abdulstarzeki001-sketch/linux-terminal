"""Offline tests for STAR AI's constrained local diagnostic worker."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from local_worker.worker import (
    MAX_OUTPUT_CHARS, TASKS, InvalidJob, clean_environment,
    execute_job, main, validate_job,
)


class LocalWorkerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.workspace = Path(self.temp.name)
        (self.workspace / ".git").mkdir()
        self.job = {"id": "job-001", "kind": "diagnostic", "task": "python_version"}

    def test_task_catalog_is_fixed(self):
        self.assertIn("git_status", TASKS)
        self.assertNotIn("shell", TASKS)
        self.assertNotIn("curl", TASKS)

    def test_rejects_untrusted_commands_and_extra_keys(self):
        for data in (
            {"id": "job-001", "kind": "shell", "task": "python_version"},
            {"id": "job-001", "kind": "diagnostic", "task": "bash -c whoami"},
            {**self.job, "command": "cat ~/.env"},
            {**self.job, "id": "../escape"},
            {**self.job, "id": "x" * 82},
            ["not", "a", "job"],
        ):
            with self.subTest(data=data):
                with self.assertRaises(InvalidJob):
                    validate_job(data)

    def test_no_execution_without_approval(self):
        with patch("subprocess.run") as call:
            with self.assertRaises(PermissionError):
                execute_job(self.job, workspace=self.workspace, approved=False, runner=call)
            call.assert_not_called()

    def test_shell_is_disabled_and_cwd_explicit(self):
        spy = []
        def fake_runner(argv, **kwargs):
            spy.append((argv, kwargs))
            return SimpleNamespace(returncode=0, stdout="Python 3.14.7\n", stderr="")
        result = execute_job(self.job, workspace=self.workspace, approved=True, runner=fake_runner)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["exit_code"], 0)
        self.assertEqual(result["source"], "star-ai-local-worker")
        self.assertEqual(result["stdout"], "Python 3.14.7\n")
        self.assertEqual(spy[0][0], list(TASKS["python_version"]))
        self.assertIs(spy[0][1]["shell"], False)
        self.assertEqual(spy[0][1]["cwd"], str(self.workspace))
        self.assertEqual(spy[0][1]["timeout"], 15)
        self.assertEqual(spy[0][1]["env"], clean_environment())

    def test_secrets_and_proxies_do_not_reach_child(self):
        with patch.dict(os.environ, {
            "OPENAI_API_KEY": "secret",
            "AI_GATEWAY_TOKEN": "secret",
            "HTTPS_PROXY": "http://secret.example",
            "GITHUB_TOKEN": "secret",
        }):
            env = clean_environment()
            for secret_key in ("OPENAI_API_KEY", "AI_GATEWAY_TOKEN", "HTTPS_PROXY", "GITHUB_TOKEN"):
                self.assertNotIn(secret_key, env)

    def test_reports_nonzero_exit_code(self):
        result = execute_job(self.job, workspace=self.workspace, approved=True,
            runner=lambda argv, **kwargs: SimpleNamespace(
                returncode=128, stdout="", stderr="not a git repository"
            ))
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["exit_code"], 128)

    def test_timeouts_are_bounded(self):
        def timeout_runner(argv, **kwargs):
            raise subprocess.TimeoutExpired(argv, kwargs["timeout"])
        result = execute_job(self.job, workspace=self.workspace, approved=True,
                             runner=timeout_runner)
        self.assertEqual(result["status"], "timeout")
        self.assertEqual(result["exit_code"], 124)

    def test_missing_binary_is_reported_without_traceback(self):
        def missing_runner(argv, **kwargs):
            raise FileNotFoundError("not found")
        result = execute_job(self.job, workspace=self.workspace, approved=True,
                             runner=missing_runner)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["exit_code"], 127)

    def test_output_is_truncated(self):
        result = execute_job(self.job, workspace=self.workspace, approved=True,
            runner=lambda argv, **kwargs: SimpleNamespace(
                returncode=0, stdout="X" * (MAX_OUTPUT_CHARS + 15), stderr=""
            ))
        self.assertEqual(len(result["stdout"]), MAX_OUTPUT_CHARS)
        self.assertTrue(result["truncated"])

    def test_rejects_non_repository_directory(self):
        another = self.workspace / "empty"
        another.mkdir()
        with self.assertRaises(InvalidJob):
            execute_job(self.job, workspace=another, approved=True)

    def test_cli_rejects_without_approval_and_never_runs(self):
        import io
        from contextlib import redirect_stdout
        stdout = io.StringIO()
        with redirect_stdout(stdout), patch("subprocess.run") as call:
            code = main(["--task", "python_version", "--workspace", str(self.workspace)])
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(stdout.getvalue())["status"], "rejected")
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
