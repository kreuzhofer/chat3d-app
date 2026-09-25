-- ADR 0004 amended (2026-09-25, #96/#112): the false-fail allowance gains an
-- absolute floor beside the ratio — max(2 × reference false fails,
-- 5 % of the reference's passes on the set). The reference's pass count over
-- the sitting's whole example set is frozen with the sitting (NULL = before
-- the amendment, or a reference that is not a stored run; the floor is 0).
ALTER TABLE adjudication_sittings ADD COLUMN reference_passes INTEGER;
