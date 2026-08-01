from __future__ import annotations

import contextlib
import io
import json
import traceback
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any


@dataclass
class NotebookExecutionResult:
    path: Path
    succeeded: bool
    executed_cells: int


def execute_notebook(path: Path, working_directory: Path | None = None) -> NotebookExecutionResult:
    notebook = json.loads(path.read_text(encoding="utf-8"))
    namespace = {
        "__name__": "__main__",
        "__file__": str(path),
    }
    executed_cells = 0
    cwd = working_directory or path.parent
    with _temporary_chdir(cwd):
        for cell_index, cell in enumerate(notebook.get("cells", [])):
            if cell.get("cell_type") != "code":
                continue
            executed_cells += 1
            cell["execution_count"] = executed_cells
            cell["outputs"] = []
            stdout = io.StringIO()
            stderr = io.StringIO()
            code = "".join(cell.get("source", []))
            try:
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    exec(compile(code, f"{path}::cell-{cell_index}", "exec"), namespace)
            except Exception:
                trace = traceback.format_exc()
                combined_stderr = stderr.getvalue() + trace
                if stdout.getvalue():
                    cell["outputs"].append(_stream_output("stdout", stdout.getvalue()))
                cell["outputs"].append(_error_output(combined_stderr))
                path.write_text(json.dumps(notebook, indent=2), encoding="utf-8")
                return NotebookExecutionResult(path=path, succeeded=False, executed_cells=executed_cells)
            if stdout.getvalue():
                cell["outputs"].append(_stream_output("stdout", stdout.getvalue()))
            if stderr.getvalue():
                cell["outputs"].append(_stream_output("stderr", stderr.getvalue()))
    path.write_text(json.dumps(notebook, indent=2), encoding="utf-8")
    return NotebookExecutionResult(path=path, succeeded=True, executed_cells=executed_cells)


def _stream_output(name: str, text: str) -> dict[str, Any]:
    return {
        "output_type": "stream",
        "name": name,
        "text": text,
    }


def _error_output(traceback_text: str) -> dict[str, Any]:
    return {
        "output_type": "error",
        "ename": "ExecutionError",
        "evalue": "Notebook execution failed",
        "traceback": traceback_text.splitlines(),
    }


@contextlib.contextmanager
def _temporary_chdir(path: Path):
    import os

    previous = Path.cwd()
    os.chdir(path)
    try:
        yield SimpleNamespace(path=path)
    finally:
        os.chdir(previous)
