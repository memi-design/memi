from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from analysis.notebook_executor import execute_notebook


class NotebookExecutorTests(unittest.TestCase):
    def test_executes_with_working_directory_on_import_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "local_module.py").write_text("VALUE = 42\n", encoding="utf-8")
            notebook_path = root / "analysis.ipynb"
            notebook_path.write_text(json.dumps({
                "cells": [{
                    "cell_type": "code",
                    "execution_count": None,
                    "outputs": [],
                    "source": ["from local_module import VALUE\n", "print(VALUE)\n"],
                }],
            }), encoding="utf-8")

            result = execute_notebook(notebook_path, working_directory=root)

            self.assertTrue(result.succeeded)
            executed = json.loads(notebook_path.read_text(encoding="utf-8"))
            self.assertEqual(executed["cells"][0]["outputs"][0]["text"], "42\n")


if __name__ == "__main__":
    unittest.main()
