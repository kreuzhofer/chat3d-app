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

# Pyrender 0.1.45 uses np.infty, removed in NumPy 2.0
if not hasattr(np, "infty"):
    np.infty = np.inf  # type: ignore[attr-defined]

# Must be set BEFORE importing pyrender / OpenGL
os.environ["PYOPENGL_PLATFORM"] = "egl"

import trimesh  # noqa: E402
import pyrender  # noqa: E402
from pyrender.constants import RenderFlags  # noqa: E402

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
    elif angle == "interior":
        # 30° azimuth, 70° elevation — steep downward look into the model.
        # At 70° the camera sees over 50 mm walls (occlusion depth ~18 mm),
        # making all interior features visible (standoffs, bosses, ribs).
        # Azimuth 30° avoids exact alignment with box edges for clarity.
        azimuth = math.radians(30)
        elevation = math.radians(70)
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


# ── Angle-aware key lighting ──────────────────────────────────────────

# Views where the camera looks along a principal axis (top→down, bottom→up).
# These need near-horizontal lighting because vertical features (standoffs,
# bosses, ribs) share surface normals with the floor and are invisible
# under co-located or shallow-offset lighting.
_PLANAR_VIEWS = frozenset(("top", "bottom"))


def _make_light_pose(eye: np.ndarray, target: np.ndarray) -> np.ndarray:
    """Build a look-at pose for a directional light, auto-selecting up."""
    fwd = target - eye
    fwd = fwd / np.linalg.norm(fwd)
    up = np.array([0.0, 1.0, 0.0])
    if abs(np.dot(fwd, up)) > 0.9:
        up = np.array([0.0, 0.0, -1.0])
    return _look_at(eye, target, up)


def _build_key_lights(
    angle: str,
    cam_pose: np.ndarray,
    center: np.ndarray,
    distance: float,
) -> list[tuple[np.ndarray, float]]:
    """Return [(pose, intensity), ...] for the key lights for this view.

    Top/bottom views use aggressive cross-lighting (~65° from camera axis)
    so vertical features are brightly lit while horizontal surfaces are dim.
    Other views use a moderate offset (~40°) for depth without over-darkening.
    """
    eye_cam = cam_pose[:3, 3]
    right = cam_pose[:3, 0]
    up_cam = cam_pose[:3, 1]

    if angle in _PLANAR_VIEWS:
        # Near-horizontal cross-lighting from two sides (~65° from camera
        # axis).  Combined with SHADOWS_DIRECTIONAL this produces the best
        # results for interior feature detection: the VLM can confirm all
        # four standoff positions despite a checkerboard-like shadow pattern
        # from opposing wall shadows (scored 7/10 vs 4-5 without shadows).
        primary = eye_cam + right * distance * 2.0 + up_cam * distance * 1.0
        secondary = eye_cam - right * distance * 1.5 - up_cam * distance * 0.8
        return [
            (_make_light_pose(primary, center), 3.5),
            (_make_light_pose(secondary, center), 2.0),
        ]
    else:
        # Moderate offset: factors (0.8, 0.6) → ~40° from camera axis.
        offset = right * distance * 0.8 + up_cam * distance * 0.6
        return [(_make_light_pose(eye_cam + offset, center), 5.0)]


# ── Main render function ─────────────────────────────────────────────

def render_screenshots(
    model_data: bytes,
    format: str = "stl",
    angles: Optional[List[str]] = None,
    width: int = 512,
    height: int = 512,
    zoom_factor: float = 1.0,
) -> List[dict]:
    """
    Render model from multiple angles, returning PNG screenshots as base64.

    Args:
        model_data: Raw binary model data (STL or 3MF).
        format: "stl" or "3mf".
        angles: List of viewing angles (default: ["front", "top", "isometric"]).
        width: Image width in pixels.
        height: Image height in pixels.
        zoom_factor: Zoom magnification (1.0 = normal, 2.0 = 2x zoom, etc.).
                     Reduces the orthographic frustum to show finer detail.

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
    # Zoom: dividing by zoom_factor tightens the frustum, magnifying the center.
    effective_zoom = max(zoom_factor, 1.0)
    ortho_half = extent * 0.85 / effective_zoom
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
        scene = pyrender.Scene(
            bg_color=[255, 255, 255, 255],
            ambient_light=[0.15, 0.15, 0.15],
        )
        scene.add(pr_mesh)

        # Orthographic camera — no perspective distortion, parallel lines stay parallel.
        camera = pyrender.OrthographicCamera(
            xmag=ortho_xmag, ymag=ortho_ymag,
            znear=znear, zfar=zfar,
        )
        cam_pose = _camera_pose_for_angle(angle, center, distance)
        scene.add(camera, pose=cam_pose)

        # Angle-aware key lights: top/bottom get near-horizontal cross-lighting
        # to reveal vertical features; other views get a moderate offset.
        for light_pose, intensity in _build_key_lights(angle, cam_pose, center, distance):
            light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=intensity)
            scene.add(light, pose=light_pose)

        # Camera-co-located fill — ensures no visible face goes completely dark.
        fill_light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=1.5)
        scene.add(fill_light, pose=cam_pose)

        # Render — enable shadow maps only for planar views (top/bottom)
        # where shadows from vertical features reveal depth.  Other views
        # rely on shading from the offset key light alone; shadow mapping
        # on angled/cardinal views added more confusion than clarity.
        flags = RenderFlags.OFFSCREEN
        if angle in _PLANAR_VIEWS:
            flags |= RenderFlags.SHADOWS_DIRECTIONAL
        color, _ = renderer.render(scene, flags=flags)

        # Convert to PNG bytes
        from PIL import Image

        img = Image.fromarray(color)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")

        results.append({"angle": angle, "base64": png_base64})

    return results
