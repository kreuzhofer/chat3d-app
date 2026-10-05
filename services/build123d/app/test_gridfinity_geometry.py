"""gridfinity_build123d on build123d 0.13 builds the parts it built on 0.10 (#135).

0.12's builder scopes made gridfinity's nested helpers place their pieces
twice (floating lips, cuts in the air) while bounding boxes stayed the same,
so these compare volumes. The references were measured on the previous
service image (build123d 0.10.1.dev e8cae06, bd_warehouse 0.2.0).
"""
import os
import sys
import warnings

import pytest

sys.path.insert(0, os.path.dirname(__file__))
warnings.simplefilter("ignore")
from build123d import *  # noqa: E402,F401,F403
from gridfinity_build123d import *  # noqa: E402,F401,F403

CASES = {
    "bin 1x1 with lip": (
        lambda: Bin(base=BaseEqual(1, 1), height=3,
                    compartments=CompartmentsEqual(div_x=1, div_y=1, compartment_list=[Compartment()]),
                    lip=StackingLip()),
        14098.5, 12.42),
    "bin 3x2 compartments, scoops, lip": (
        lambda: Bin(base=BaseEqual(3, 2), height=6,
                    compartments=Compartments(grid=[[1, 2], [1, 3]],
                                              compartment_list=[Compartment(features=[Scoop()]) for _ in range(3)]),
                    lip=StackingLip()),
        81651.4, 15.42),
    "bin 2x1 two compartments": (
        lambda: Bin(base=BaseEqual(2, 1), height_in_units=3, compartments=CompartmentsEqual(div_x=2)),
        28088.7, 18.50),
    "bin labels and scoop": (
        lambda: Bin(base=BaseEqual(2, 2), height_in_units=4,
                    compartments=CompartmentsEqual(div_x=2, div_y=1, compartment_list=[
                        Compartment(features=[Label(), Scoop()]), Compartment(features=[Label()])]),
                    lip=StackingLip()),
        65590.4, 29.62),
    "base magnet and screw holes": (
        lambda: BaseEqual(2, 2, features=[MagnetHole(BottomCorners()), ScrewHole(BottomCorners())]),
        47106.3, 5.30),
    "base countersink": (lambda: BaseEqual(1, 1, features=[ScrewHoleCountersink(BottomCorners())]), 11659.2, 5.30),
    "base counterbore": (lambda: BaseEqual(1, 1, features=[ScrewHoleCounterbore(BottomCorners())]), 11873.0, 5.30),
    "bin weighted base": (lambda: Bin(base=Base(features=[Weighted(BottomMiddle())]), height_in_units=2), 20355.1, 11.50),
    "baseplate frame": (lambda: BasePlateEqual(2, 2), 5102.0, 2.33),
    "baseplate skeleton": (lambda: BasePlateEqual(2, 2, baseplate_block=BasePlateBlockSkeleton()), 25090.8, 5.53),
}


@pytest.mark.parametrize("name", CASES)
def test_matches_build123d_010(name):
    make, volume, top = CASES[name]
    part = make()
    assert len(part.solids()) == 1
    assert part.volume == pytest.approx(volume, rel=1e-3)
    assert part.bounding_box().max.Z == pytest.approx(top, abs=0.01)
