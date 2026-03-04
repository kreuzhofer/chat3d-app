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
    elif angle == "back":
        eye = centroid + np.array([0.0, 0.0, -distance])
    elif angle == "left":
        eye = centroid + np.array([-distance, 0.0, 0.0])
    elif angle == "right":
        eye = centroid + np.array([distance, 0.0, 0.0])
    elif angle == "top":
        eye = centroid + np.array([0.0, distance, 0.0])
        up = np.array([0.0, 0.0, -1.0])  # look down, Z toward viewer
    elif angle == "bottom":
        eye = centroid + np.array([0.0, -distance, 0.0])
        up = np.array([0.0, 0.0, 1.0])  # look up, Z toward viewer
    elif angle == "ortho_45":
        # 45° azimuth, 45° elevation — orthographic 3D overview for VLM
        azimuth = math.radians(45)
        elevation = math.radians(45)
        x = distance * math.cos(elevation) * math.sin(azimuth)
        y = distance * math.sin(elevation)
        z = distance * math.cos(elevation) * math.cos(azimuth)
        eye = centroid + np.array([x, y, z])
    elif angle == "ortho_45_bottom":
        # 45° azimuth, -45° elevation — bottom-up 3D overview for VLM
        azimuth = math.radians(45)
        elevation = math.radians(-45)
        x = distance * math.cos(elevation) * math.sin(azimuth)
        y = distance * math.sin(elevation)
        z = distance * math.cos(elevation) * math.cos(azimuth)
        eye = centroid + np.array([x, y, z])
    elif angle == "isometric":
        # 45° azimuth, 35° elevation — classic isometric for thumbnails
        azimuth = math.radians(45)
        elevation = math.radians(35)
        x = distance * math.cos(elevation) * math.sin(azimuth)
        y = distance * math.sin(elevation)
        z = distance * math.cos(elevation) * math.cos(azimuth)
        eye = centroid + np.array([x, y, z])
    elif angle == "isometric_back":
        # Legacy: 225° around Y, 35° elevation (kept for backward compat)
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

    # Fix normals to ensure consistent outward-facing orientation.
    # Without this, trimesh's force="mesh" concatenation can produce
    # inverted normals on some faces (e.g. a bowl's flat base), causing
    # pyrender to cull them as back-faces.
    tmesh.fix_normals()

    # Build123d uses Z-up (CAD convention); pyrender uses Y-up (OpenGL).
    # Rotate -90° around X to match — same transform the old Three.js
    # renderer applied via geometry.rotateX(-Math.PI / 2).
    rot = trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0])
    tmesh.apply_transform(rot)

    # Compute bounds for camera positioning.
    # Use bounding box center (not centroid/center-of-mass) so the camera
    # aims at the geometric middle of the model.  For asymmetric shapes
    # like bowls the centroid is biased toward the denser hemisphere,
    # which shifts the camera target and can push the opposite side out
    # of frame.
    bounds = tmesh.bounds  # (2, 3) array: min, max
    center = (bounds[0] + bounds[1]) / 2.0
    extent = np.max(bounds[1] - bounds[0])
    if extent < 1e-10:
        raise ValueError("Model has zero extent (degenerate geometry)")
    # Camera distance — far enough that clipping doesn't occur.
    # For orthographic the distance only affects clipping and camera pose,
    # not the apparent size of the model (that's controlled by xmag/ymag).
    distance = extent * 3.0

    # Orthographic frustum: half-extent with breathing room.
    # The model's bounding box diagonal for angled views (ortho_45, isometric) is
    # larger than the axis-aligned extent, so we need extra padding.
    # 0.85 = half of 1.7× the max extent — fills ~60% of frame, safe for all angles.
    ortho_half = extent * 0.85
    ortho_ymag = ortho_half
    ortho_xmag = ortho_half * (width / height)

    # Adaptive clipping planes based on model size.
    znear = max(distance / 100.0, 0.01)
    zfar = distance * 100.0

    # Create pyrender mesh — medium blue-gray for clear contrast on white bg.
    # doubleSided=True ensures faces are visible regardless of winding order,
    # preventing missing geometry from inconsistent normals.
    material = pyrender.MetallicRoughnessMaterial(
        baseColorFactor=[0.35, 0.45, 0.58, 1.0],
        metallicFactor=0.0,
        roughnessFactor=0.85,
        doubleSided=True,
    )
    pr_mesh = pyrender.Mesh.from_trimesh(tmesh, material=material, smooth=False)

    renderer = _get_renderer(width, height)
    results: List[dict] = []

    for angle in angles:
        # Build a fresh scene per angle.
        # Low ambient + smooth shading + camera-relative key light = contrast
        # from surface normal gradients (no harsh fixed-position shadow artifacts).
        scene = pyrender.Scene(
            bg_color=[255, 255, 255, 255],
            ambient_light=[0.2, 0.2, 0.2],
        )
        scene.add(pr_mesh)

        # Orthographic camera — no perspective distortion, parallel lines stay parallel.
        # This prevents straight geometry (cylinders, pipes) from appearing tapered.
        camera = pyrender.OrthographicCamera(
            xmag=ortho_xmag, ymag=ortho_ymag,
            znear=znear, zfar=zfar,
        )
        cam_pose = _camera_pose_for_angle(angle, center, distance)
        scene.add(camera, pose=cam_pose)

        # Key light — co-located with the camera so every visible face gets
        # illumination proportional to how directly it faces the viewer.
        # With smooth shading, curved surfaces show clear bright-to-dark
        # gradients that reveal shape without creating shadow artifacts.
        key_light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=5.0)
        scene.add(key_light, pose=cam_pose)

        # Fill light — fixed soft top-down to add slight vertical contrast
        # (top-facing surfaces a bit brighter than bottom-facing).
        fill_light = pyrender.DirectionalLight(color=[0.9, 0.9, 0.95], intensity=1.0)
        fill_pose = _look_at(
            center + np.array([0.0, distance, 0.0]),
            center,
            np.array([0.0, 0.0, -1.0]),
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
