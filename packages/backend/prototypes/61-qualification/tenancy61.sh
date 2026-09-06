#!/bin/zsh
# Who else was on the qwen pool while a run was in flight (issue #61). One row per 3-minute bucket:
# the judge's own calls (source = experiment) against every other tenant on the same served name.
# Usage: tenancy61.sh <label> <from ISO> <to ISO>   e.g. tenancy61.sh arm2 2026-09-06T13:32:00Z 2026-09-06T13:46:30Z
cd /Users/daniel/src/github/kreuzhofer/chat3d-app
docker compose exec -T postgres psql -U chat3d -d chat3d -Atc "
select '$1' arm, to_char(date_trunc('minute', u.created_at) - (extract(minute from u.created_at)::int % 3) * interval '1 minute','HH24:MI') bucket3,
 count(*) filter (where u.source='experiment') judge_calls,
 count(*) filter (where u.source is distinct from 'experiment') other_calls,
 string_agg(distinct case when u.source is distinct from 'experiment' then coalesce(u.source_label,u.source,'?') end, ', ') other_sources
from llm_usage_events u
where u.provider_name='vllm-dgx-14' and u.model_name like 'qwen3.8-27b-nvfp4%' and u.created_at between '$2' and '$3'
group by 1,2 order by 1,2"
