-- Rollback of M6.1: restores the M6 version of the function (including its true/false gap).

create or replace function public.valid_question_payload(qtype text, stem text, c jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  o jsonb;
  b jsonb;
  v jsonb;
  ids text[] := '{}';
  texts text[] := '{}';
  seen text[] := '{}';
  i text;
  n int;
begin
  if c is null or jsonb_typeof(c) is distinct from 'object' then return false; end if;
  if not public.valid_scoring(qtype, c -> 'scoring') then return false; end if;

  if qtype in ('SBA', 'MULTIPLE_MCQ') then
    if qtype = 'SBA' then
      if (c - array['options', 'correct_option_id', 'scoring']) <> '{}'::jsonb then return false; end if;
    else
      if (c - array['options', 'correct_option_ids', 'scoring']) <> '{}'::jsonb then return false; end if;
    end if;
    o := c -> 'options';
    if jsonb_typeof(o) is distinct from 'array' then return false; end if;
    n := jsonb_array_length(o);
    if n < 2 or n > 12 then return false; end if;
    for b in select value from jsonb_array_elements(o) loop
      if jsonb_typeof(b) is distinct from 'object' then return false; end if;
      if (b - array['id', 'text', 'explanation']) <> '{}'::jsonb then return false; end if;
      if jsonb_typeof(b -> 'id') is distinct from 'string' then return false; end if;
      if jsonb_typeof(b -> 'text') is distinct from 'string' then return false; end if;
      i := b ->> 'id';
      if i !~ '^[A-Za-z0-9_-]{1,40}$' then return false; end if;
      if char_length(btrim(b ->> 'text')) not between 1 and 2000 then return false; end if;
      if b ? 'explanation' then
        if jsonb_typeof(b -> 'explanation') is distinct from 'string' then return false; end if;
        if char_length(b ->> 'explanation') > 4000 then return false; end if;
      end if;
      if i = any (ids) then return false; end if;
      if public.norm_name(b ->> 'text') = any (texts) then return false; end if; -- two identical options
      ids := ids || i;
      texts := texts || public.norm_name(b ->> 'text');
    end loop;

    if qtype = 'SBA' then
      if jsonb_typeof(c -> 'correct_option_id') is distinct from 'string' then return false; end if;
      return (c ->> 'correct_option_id') = any (ids);
    end if;

    v := c -> 'correct_option_ids';
    if jsonb_typeof(v) is distinct from 'array' then return false; end if;
    if jsonb_array_length(v) < 2 or jsonb_array_length(v) > n then return false; end if;
    for b in select value from jsonb_array_elements(v) loop
      if jsonb_typeof(b) is distinct from 'string' then return false; end if;
      i := b #>> '{}';
      if not (i = any (ids)) or i = any (seen) then return false; end if;
      seen := seen || i;
    end loop;
    return true;

  elsif qtype = 'TRUE_FALSE' then
    if (c - array['correct_answer', 'scoring']) <> '{}'::jsonb then return false; end if;
    return jsonb_typeof(c -> 'correct_answer') = 'boolean';

  elsif qtype = 'FILL_GAP' then
    if (c - array['blanks', 'normalization', 'scoring']) <> '{}'::jsonb then return false; end if;
    if c ? 'normalization' then
      v := c -> 'normalization';
      if jsonb_typeof(v) is distinct from 'object' then return false; end if;
      if (v - array['case_sensitive', 'strip_punctuation']) <> '{}'::jsonb then return false; end if;
      if v ? 'case_sensitive' and jsonb_typeof(v -> 'case_sensitive') is distinct from 'boolean' then return false; end if;
      if v ? 'strip_punctuation' and jsonb_typeof(v -> 'strip_punctuation') is distinct from 'boolean' then return false; end if;
    end if;
    o := c -> 'blanks';
    if jsonb_typeof(o) is distinct from 'array' then return false; end if;
    n := jsonb_array_length(o);
    if n < 1 or n > 20 then return false; end if;
    for b in select value from jsonb_array_elements(o) loop
      if jsonb_typeof(b) is distinct from 'object' then return false; end if;
      if (b - array['id', 'accepted_answers', 'case_sensitive']) <> '{}'::jsonb then return false; end if;
      if jsonb_typeof(b -> 'id') is distinct from 'string' then return false; end if;
      i := b ->> 'id';
      if i !~ '^[A-Za-z0-9_-]{1,40}$' or i = any (ids) then return false; end if;
      if position(('{{' || i || '}}') in stem) = 0 then return false; end if; -- the stem must show where the blank goes
      ids := ids || i;
      if b ? 'case_sensitive' and jsonb_typeof(b -> 'case_sensitive') is distinct from 'boolean' then return false; end if;
      v := b -> 'accepted_answers';
      if jsonb_typeof(v) is distinct from 'array' then return false; end if;
      if jsonb_array_length(v) < 1 or jsonb_array_length(v) > 20 then return false; end if;
      for o in select value from jsonb_array_elements(v) loop
        if jsonb_typeof(o) is distinct from 'string' then return false; end if;
        if char_length(btrim(o #>> '{}')) not between 1 and 200 then return false; end if;
      end loop;
    end loop;
    return true;
  end if;
  return false;
end;
$$;
