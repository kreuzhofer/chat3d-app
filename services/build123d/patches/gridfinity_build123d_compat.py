"""build123d 0.10 builder semantics for gridfinity_build123d's helpers (#135).

Installed into the gridfinity_build123d package and imported from its
__init__ by patch_libraries.py.

gridfinity builds its pieces in plain helper methods (`StackingLip.create`,
`Compartments.create`, every feature's `create_obj`, `Utils.place_by_grid`, ...)
that open their own `BuildPart` and return `BasePartObject(part, rotation,
align, mode)`, called inside the caller's builder and `Locations`. Since
build123d 0.12's BuildScope refactor, such a nested builder is itself placed
by the caller's `Locations` and published into the caller's builder, and the
returned object is placed and combined again: lips float one bin height too
high as a second solid, and compartment, magnet and screw cuts land in the
air, so bins come out solid. Only `Base*Object` constructors are isolated
from the caller ("firewall"), and these helpers are plain methods.

The wrapper restores what 0.10 did: run the helper with no active build
scope, so it builds at the origin, then construct the result in the caller's
scope, where it is placed at the caller's locations and combined with the
caller's mode. Verified against 0.10 by volume and bounding box on bins
(lip, compartments, scoops, labels, weighted), bases (magnet, screw,
countersink, counterbore holes) and every baseplate block.

It relies on build123d's private `build_common._build_scope` ContextVar,
pinned with build123d==0.13.0; the import fails if that changes.
"""
import contextlib
import contextvars
import functools
import inspect

from build123d import BasePartObject, Mode
from build123d import build_common as _build_common

from . import baseplate, bin as bin_, compartments, features, utils

_SCOPE = getattr(_build_common, "_build_scope", None)
if not isinstance(_SCOPE, contextvars.ContextVar):
    raise ImportError("build123d.build_common._build_scope changed: gridfinity compat needs a port")


@contextlib.contextmanager
def _top_level():
    token = _SCOPE.set(None)
    try:
        yield
    finally:
        _SCOPE.reset(token)


def _isolated(fn):
    sig = inspect.signature(fn)

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        mode = bound.arguments.get("mode", Mode.ADD)
        with _top_level():
            obj = fn(*bound.args, **bound.kwargs)
        return BasePartObject(obj, mode=mode)

    return wrapper


def _install():
    wrapped = []
    for module in (baseplate, bin_, compartments, features, utils):
        for cls in vars(module).values():
            if not inspect.isclass(cls) or cls.__module__ != module.__name__:
                continue
            for name in ("create", "create_obj"):
                fn = cls.__dict__.get(name)
                if inspect.isfunction(fn) and not getattr(fn, "__isabstractmethod__", False):
                    setattr(cls, name, _isolated(fn))
                    wrapped.append(f"{cls.__name__}.{name}")
    for name in ("place_by_grid", "create_bin_platform"):
        raw = utils.Utils.__dict__[name]
        setattr(utils.Utils, name, staticmethod(_isolated(raw.__func__)))
        wrapped.append(f"Utils.{name}")
    return wrapped


# Every builder helper of fc29ac6: a renamed or added one must be looked at.
_EXPECTED = 17
WRAPPED = _install()
if len(WRAPPED) != _EXPECTED:
    raise ImportError(f"gridfinity compat wrapped {len(WRAPPED)} helpers, expected {_EXPECTED}: {WRAPPED}")
