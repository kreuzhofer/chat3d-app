"""
Stub for ocp_vscode — satisfies imports from bd_warehouse.gear without
requiring the actual CAD visualization package (which needs a GUI).
"""


class Camera:
    def __init__(self, *args, **kwargs):
        pass


def show(*args, **kwargs):
    """No-op: visualization not available in headless mode."""
    pass


def set_defaults(*args, **kwargs):
    """No-op: visualization not available in headless mode."""
    pass
