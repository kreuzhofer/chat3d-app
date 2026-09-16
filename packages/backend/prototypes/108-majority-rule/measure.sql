-- #108: does a third judge's reading reproduce Daniel's verdicts? Per triage
-- model, direction, verdict side and confidence; baselines beside it.
with a as (
  select s.title, s.candidate_label, s.reference_label,
    case when a.triage_model like 'Claude Fable%' then 'Fable (imported sittings)' when a.triage_model like '%Kimi%' then 'Kimi K3 (app sittings)' else 'none' end model,
    a.decision, a.triage_verdict, a.triage_confidence, a.ref_state, a.cand_state,
    case when a.cand_state='fail' and a.ref_state='pass' then 'cand fails / ref passes (false-fail question)'
         when a.cand_state='pass' and a.ref_state='fail' then 'cand passes / ref fails (false-pass question)'
         else 'one side uncertain' end dir
  from adjudications a join adjudication_sittings s on s.id=a.sitting_id
  where a.decision in ('R','C') and s.title not like 'Kimi K3 (thinking off) vs%')
select 'A. by model' k, model g, '' g2, count(*) items,
  count(*) filter (where triage_verdict in ('R','C')) answered,
  count(*) filter (where triage_verdict=decision) right_, count(*) filter (where triage_verdict in ('R','C') and triage_verdict<>decision) wrong,
  count(*) filter (where triage_verdict='N' or triage_verdict is null) residual,
  count(*) filter (where decision='R') daniel_R, count(*) filter (where decision='C') daniel_C
from a group by 1,2,3
union all
select 'B. by model x direction', model, dir, count(*), count(*) filter (where triage_verdict in ('R','C')), count(*) filter (where triage_verdict=decision), count(*) filter (where triage_verdict in ('R','C') and triage_verdict<>decision), count(*) filter (where triage_verdict='N' or triage_verdict is null), count(*) filter (where decision='R'), count(*) filter (where decision='C')
from a group by 1,2,3
union all
select 'C. by model x triage side', model, 'triage says '||coalesce(triage_verdict,'-'), count(*), count(*) filter (where triage_verdict in ('R','C')), count(*) filter (where triage_verdict=decision), count(*) filter (where triage_verdict in ('R','C') and triage_verdict<>decision), count(*) filter (where triage_verdict='N' or triage_verdict is null), count(*) filter (where decision='R'), count(*) filter (where decision='C')
from a group by 1,2,3
union all
select 'D. by model x confidence', model, 'confidence '||coalesce(triage_confidence,'-'), count(*), count(*) filter (where triage_verdict in ('R','C')), count(*) filter (where triage_verdict=decision), count(*) filter (where triage_verdict in ('R','C') and triage_verdict<>decision), count(*) filter (where triage_verdict='N' or triage_verdict is null), count(*) filter (where decision='R'), count(*) filter (where decision='C')
from a group by 1,2,3
order by 1,2,3;

-- E/F: the one-sided rule — the third judge sides with the incumbent (C) — by confidence and by direction.
with a as (
  select case when a.triage_model like 'Claude Fable%' then 'Fable' when a.triage_model like '%Kimi%' then 'Kimi K3' else 'none' end model,
    a.decision, a.triage_verdict, coalesce(a.triage_confidence,'-') conf,
    case when a.cand_state='fail' and a.ref_state='pass' then 'false-fail question' when a.cand_state='pass' and a.ref_state='fail' then 'false-pass question' else 'one side uncertain' end dir
  from adjudications a join adjudication_sittings s on s.id=a.sitting_id
  where a.decision in ('R','C') and s.title not like 'Kimi K3 (thinking off) vs%' and a.triage_verdict in ('R','C'))
select 'E. side x confidence' k, model, 'says '||triage_verdict||' @ '||conf g2, count(*) items, count(*) filter (where triage_verdict=decision) right_, count(*) filter (where triage_verdict<>decision) wrong from a group by 1,2,3
union all
select 'F. side x direction', model, 'says '||triage_verdict||' on '||dir, count(*), count(*) filter (where triage_verdict=decision), count(*) filter (where triage_verdict<>decision) from a group by 1,2,3
order by 1,2,3;
