"""
Offscreen STL/3MF screenshot renderer using pyrender + EGL.

Produces PNG screenshots from multiple viewing angles (~0.1-1.2s per angle).
Requires: PYOPENGL_PLATFORM=egl (set before importing pyrender).
"""

import os
import io
import math
import logging
import base64
from typing import List, Optional

import numpy as np

# Must be set BEFORE importing pyrender / OpenGL
os.environ["PYOPENGL_PLATFORM"] = "egl"

import trimesh  # noqa: E402
import pyrender  # noqa: E402

logger = logging.getLogger(__name__)

# ── Lazy renderer singleton ──────────────────────────────────────────

_renderer: Optional[pyrender.OffscreenRenderer] = None
_renderer_size: tuple[int, int] = (0, 0)


def _get_renderer(width: int, height: int) -> pyrender.OffscreenRenderer:
    """Get or create the offscreen renderer, recreating if size changed."""
    global _renderer, _renderer_size
    if _renderer is not None and _renderer_size == (width, height):
        return _renderer
    if _renderer is not None:
        try:
            _renderer.delete()
        except Exception:
            pass
    logger.info(f"Creating OffscreenRenderer({width}x{height})")
    _renderer = pyrender.OffscreenRenderer(width, height)
    _renderer_size = (width, height)
    return _renderer


# ── Camera setup ─────────────────────────────────────────────────────

def _look_at(eye: np.ndarray, target: np.ndarray, up: np.ndarray) -> np.ndarray:
    """Build a 4x4 camera-to-world matrix (OpenGL convention: -Z forward)."""
    forward = target - eye
    forward = forward / np.linalg.norm(forward)
    right = np.cross(forward, up)
    right = right / np.linalg.norm(right)
    true_up = np.cross(right, forward)

    mat = np.eye(4)
    mat[:3, 0] = right
    mat[:3, 1] = true_up
    mat[:3, 2] = -forward
    mat[:3, 3] = eye
    return mat


def _camera_pose_for_angle(
    angle: str, centroid: np.ndarray, distance: float
) -> np.ndarray:
    """Return a 4x4 camera pose matrix for the given viewing angle."""
    up = np.array([0.0, 1.0, 0.0])

    if angle == "front":
        eye = centroid + np.array([0.0, 0.0, distance])
    elif angle == "top":
        eye = centroid + np.array([0.0, distance, 0.0])
        up = np.array([0.0, 0.0, -1.0])  # look down, Z toward viewer
    elif angle == "isometric":
        # 45° around Y, 35° elevation
        azimuth = math.radians(45)
        elevation = math.radians(35)
        x = distance * math.cos(elevation) * math.sin(azimuth)
        y = distance * math.sin(elevation)
        z = distance * math.cos(elevation) * math.cos(azimuth)
        eye = centroid + np.array([x, y, z])
    elif angle == "isometric_back":
        # Opposite of isometric: 225° around Y (45° + 180°), same 35° elevation
        azimuth = math.radians(225)
        elevation = math.radians(35)
        x = distance * math.cos(elevation) * math.sin(azimuth)
        y = distance * math.sin(elevation)
        z = distance * math.cos(elevation) * math.cos(azimuth)
        eye = centroid + np.array([x, y, z])
    else:
        # Fallback: treat as front
        eye = centroid + np.array([0.0, 0.0, distance])

    return _look_at(eye, centroid, up)


# ── Main render function ─────────────────────────────────────────────

def render_screenshots(
    model_data: bytes,
    format: str = "stl",
    angles: Optional[List[str]] = None,
    width: int = 512,
    height: int = 512,
) -> List[dict]:
    """
    Render model from multiple angles, returning PNG screenshots as base64.

    Args:
        model_data: Raw binary model data (STL or 3MF).
        format: "stl" or "3mf".
        angles: List of viewing angles (default: ["front", "top", "isometric"]).
        width: Image width in pixels.
        height: Image height in pixels.

    Returns:
        List of {"angle": str, "base64": str} dicts (PNG, no data URL prefix).
    """
    if angles is None:
        angles = ["front", "top", "isometric"]

    # Load mesh from binary data
    file_type = format.lower()
    if file_type == "3mf":
        file_type = "3mf"

    try:
        mesh_or_scene = trimesh.load(
            io.BytesIO(model_data),
            file_type=file_type,
            force="mesh",
        )
    except Exception as e:
        raise ValueError(f"Failed to load {format} model: {e}") from e

    # Convert to single mesh if scene was returned
    if isinstance(mesh_or_scene, trimesh.Scene):
        mesh_or_scene = mesh_or_scene.dump(concatenate=True)

    tmesh: trimesh.Trimesh = mesh_or_scene  # type: ignore

    # Validate mesh has geometry
    if tmesh.bounds is None or len(tmesh.vertices) == 0:
        raise ValueError("Model contains no geometry (empty mesh)")

    # Compute bounds for camera positioning
    bounds = tmesh.bounds  # (2, 3) array: min, max
    centroid = tmesh.centroid
    extent = np.max(bounds[1] - bounds[0])
    if extent < 1e-10:
        raise ValueError("Model has zero extent (degenerate geometry)")
    # Distance so model fills ~70% of frame with 60° FOV
    distance = extent / (2 * math.tan(math.radians(30))) * 1.4

    # Create pyrender mesh — medium blue-gray for clear contrast on white bg
    material = pyrender.MetallicRoughnessMaterial(
        baseColorFactor=[0.35, 0.45, 0.58, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.85,
    )
    pr_mesh = pyrender.Mesh.from_trimesh(tmesh, material=material, smooth=False)

    renderer = _get_renderer(width, height)
    results: List[dict] = []

    for angle in angles:
        # Build a fresh scene per angle
        scene = pyrender.Scene(
            bg_color=[255, 255, 255, 255],
            ambient_light=[0.45, 0.45, 0.45],
        )
        scene.add(pr_mesh)

        # Camera
        camera = pyrender.PerspectiveCamera(yfov=math.radians(60), aspectRatio=width / height)
        cam_pose = _camera_pose_for_angle(angle, centroid, distance)
        scene.add(camera, pose=cam_pose)

        # Lights: key light + fill light
        key_light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=3.0)
        key_pose = _camera_pose_for_angle(angle, centroid, distance * 1.2)
        scene.add(key_light, pose=key_pose)

        fill_light = pyrender.DirectionalLight(color=[0.8, 0.85, 0.9], intensity=1.5)
        fill_pose = _look_at(
            centroid + np.array([-distance * 0.5, distance * 0.3, distance * 0.3]),
            centroid,
            np.array([0.0, 1.0, 0.0]),
        )
        scene.add(fill_light, pose=fill_pose)

        # Render
        color, _ = renderer.render(scene)

        # Convert to PNG bytes
        from PIL import Image

        img = Image.fromarray(color)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        results.append({"angle": angle, "base64": png_base64})

    return results
