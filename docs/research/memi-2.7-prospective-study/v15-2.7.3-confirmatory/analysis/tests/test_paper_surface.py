from __future__ import annotations

import unittest
from pathlib import Path


class PaperSurfaceTests(unittest.TestCase):
    def test_main_tex_has_public_conference_paper_structure(self) -> None:
        paper = (Path(__file__).resolve().parents[2] / "main.tex").read_text(encoding="utf-8")

        required_roles = (
            r"\begin{abstract}",
            r"\section{Introduction}",
            r"\section{Study design}",
            r"\section{Results}",
            r"\section{Discussion}",
            r"\section{Threats to validity}",
            r"\section{Reproducibility and disclosure}",
        )
        for role in required_roles:
            self.assertIn(role, paper)

        self.assertIn(r"\RQ{1}", paper)
        self.assertIn(r"\RQ{2}", paper)
        self.assertIn(r"\RQ{3}", paper)
        self.assertIn("model-graded", paper)
        self.assertNotIn("Artifact status:", paper)
        self.assertNotIn(r"\section{2.7.4 remediation and release gates}", paper)


if __name__ == "__main__":
    unittest.main()
