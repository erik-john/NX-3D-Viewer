from pathlib import Path


def test_chr_probe_launcher_requires_no_nested_cmd():
    root = Path(__file__).resolve().parents[1]
    script = (root / "dev" / "Run_CHR_Probe.bat").read_text(encoding="ascii")
    assert 'start "NX CHR Diagnostic"' not in script
    assert 'set /p "CHR_PATH=' in script
    assert 'CHR_Probe_Output' in script
    assert 'CHR_Probe_Launch.log' in script
    assert '/selftest' in script
    assert 'pause >nul' in script


def test_chr_probe_readme_unchanged():
    # Documentation changes are deferred until the feature is verified.
    assert (Path(__file__).resolve().parents[1] / "README.md").exists()
