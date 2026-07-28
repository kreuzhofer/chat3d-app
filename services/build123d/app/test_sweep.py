"""Tests for orphan temp-dir sweeping (crash-leaked render scratch dirs)."""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(__file__))
import main


def _make_dir(base, name, age_seconds):
    path = os.path.join(base, name)
    os.mkdir(path)
    stamp = time.time() - age_seconds
    os.utime(path, (stamp, stamp))
    return path


def test_sweep_removes_only_stale_tmp_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    stale = _make_dir(str(tmp_path), "tmpstale123", age_seconds=3 * 60 * 60)
    fresh = _make_dir(str(tmp_path), "tmpfresh456", age_seconds=60)
    unrelated = _make_dir(str(tmp_path), "renders", age_seconds=3 * 60 * 60)
    tmp_file = os.path.join(str(tmp_path), "tmpnotadir.txt")
    with open(tmp_file, "w") as fh:
        fh.write("x")
    old_stamp = time.time() - 3 * 60 * 60
    os.utime(tmp_file, (old_stamp, old_stamp))

    removed = main.sweep_orphan_tmpdirs(2 * 60 * 60, force=True)

    assert removed == 1
    assert not os.path.exists(stale)
    assert os.path.exists(fresh)
    assert os.path.exists(unrelated)
    assert os.path.exists(tmp_file)


def test_sweep_age_zero_removes_fresh_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    fresh = _make_dir(str(tmp_path), "tmpfresh789", age_seconds=0)

    removed = main.sweep_orphan_tmpdirs(0, force=True)

    assert removed == 1
    assert not os.path.exists(fresh)


def test_sweep_disabled_outside_container(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(main, "_TMP_SWEEP_ENABLED", False)
    stale = _make_dir(str(tmp_path), "tmpstale999", age_seconds=3 * 60 * 60)

    removed = main.sweep_orphan_tmpdirs(0)

    assert removed == 0
    assert os.path.exists(stale)
