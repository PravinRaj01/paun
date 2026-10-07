"""Regression test for the daily job's publish step (.github/scripts/publish-snapshot.sh).

It runs the real script against a throwaway local "GitHub" (a bare repo) and checks the sequence that broke in production:
  run 1  - the `data` branch does not exist yet: it must be created
  run 2  - the branch exists AND an untracked market-snapshot.json sits in the work tree (what the old workflow left behind):
           this used to abort with "untracked working tree files would be overwritten by checkout"
  run 3  - identical content: it must succeed and add no commit
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / ".github" / "scripts" / "publish-snapshot.sh"


def _bash() -> str | None:
    if sys.platform == "win32":  # `bash` on PATH can be the WSL launcher; use Git for Windows' bash explicitly
        for p in ("C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"):
            if Path(p).exists():
                return p
        return None
    return shutil.which("bash")


BASH = _bash()
pytestmark = pytest.mark.skipif(BASH is None or shutil.which("git") is None, reason="needs bash and git")


def git(cwd: Path, *args: str) -> str:
    out = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def publish(work: Path, snapshot: Path) -> subprocess.CompletedProcess:
    return subprocess.run([BASH, SCRIPT.as_posix(), snapshot.as_posix()], cwd=work, capture_output=True, text=True)


@pytest.fixture()
def repos(tmp_path: Path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(remote)], check=True, capture_output=True)
    work = tmp_path / "work"
    subprocess.run(["git", "clone", str(remote), str(work)], check=True, capture_output=True)
    git(work, "config", "user.name", "tester")
    git(work, "config", "user.email", "tester@example.com")
    git(work, "checkout", "-B", "main")
    (work / "README.md").write_text("main branch content\n")
    git(work, "add", "README.md")
    git(work, "commit", "-m", "init")
    git(work, "push", "origin", "main")
    return remote, work, tmp_path


def data_file(remote: Path) -> str:
    return git(remote, "show", "data:market-snapshot.json")


def data_commits(remote: Path) -> int:
    return int(git(remote, "rev-list", "--count", "data"))


def test_publish_creates_then_updates_the_data_branch_even_with_a_stray_untracked_file(repos):
    remote, work, tmp = repos
    snap = tmp / "outside" / "market-snapshot.json"
    snap.parent.mkdir()

    snap.write_text('{"v": 1}')
    r1 = publish(work, snap)
    assert r1.returncode == 0, r1.stderr
    assert data_file(remote) == '{"v": 1}' and data_commits(remote) == 1

    git(work, "checkout", "main")  # the next CI run starts on a fresh checkout of main
    (work / "market-snapshot.json").write_text("stale untracked build output")  # the file that used to block the checkout
    snap.write_text('{"v": 2}')
    r2 = publish(work, snap)
    assert r2.returncode == 0, r2.stderr
    assert data_file(remote) == '{"v": 2}' and data_commits(remote) == 2


def test_publish_works_when_the_snapshot_was_built_inside_the_work_tree(repos):
    """The old workflow's layout: the built file lives in the repo root, untracked, under the tracked name."""
    remote, work, tmp = repos
    first = tmp / "first.json"
    first.write_text('{"v": 1}')
    assert publish(work, first).returncode == 0

    git(work, "checkout", "main")
    inside = work / "market-snapshot.json"
    inside.write_text('{"v": 3}')
    r = publish(work, inside)
    assert r.returncode == 0, r.stderr
    assert data_file(remote) == '{"v": 3}'


def test_identical_content_adds_no_commit_and_does_not_fail(repos):
    remote, work, tmp = repos
    snap = tmp / "s.json"
    snap.write_text('{"v": 1}')
    assert publish(work, snap).returncode == 0
    git(work, "checkout", "main")
    r = publish(work, snap)
    assert r.returncode == 0, r.stderr
    assert "no change" in r.stdout
    assert data_commits(remote) == 1


def test_missing_snapshot_file_fails_loudly(repos):
    _, work, tmp = repos
    r = publish(work, tmp / "does-not-exist.json")
    assert r.returncode != 0 and "not found" in r.stderr


def test_main_branch_is_never_touched(repos):
    remote, work, tmp = repos
    before = git(remote, "rev-parse", "main")
    snap = tmp / "s.json"
    snap.write_text('{"v": 1}')
    assert publish(work, snap).returncode == 0
    assert git(remote, "rev-parse", "main") == before
