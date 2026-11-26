create extension if not exists pgcrypto with schema extensions;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'viewer' check (role in ('administrator', 'operator', 'viewer')),
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.screens (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  pairing_attempts smallint not null default 0,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null default auth.uid() references auth.users (id),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  created_at timestamptz not null default now()
);

create table if not exists public.screen_assignments (
  screen_id uuid primary key references public.screens (id) on delete cascade,
  content jsonb not null default '{"type":"standby"}'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint screen_assignments_content_object check (jsonb_typeof(content) = 'object')
);

create table if not exists public.programme_items (
  id uuid primary key default gen_random_uuid(),
  activity text not null check (length(activity) between 1 and 120),
  presenter text check (presenter is null or length(presenter) <= 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  constraint programme_item_time_order check (ends_at > starts_at)
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.screens (label)
values ('SAMSUNG TV 1'), ('SAMSUNG TV 2'), ('SAMSUNG TV 3'), ('SAMSUNG TV 4')
on conflict (label) do nothing;

insert into public.screen_assignments (screen_id, content)
select id, '{"type":"standby"}'::jsonb from public.screens
on conflict (screen_id) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_anonymous then
    return new;
  end if;
  insert into public.user_profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.is_screen_operator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = (select auth.uid()) and role in ('administrator', 'operator')
  );
$$;

create or replace function public.is_screen_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = (select auth.uid()) and role = 'administrator'
  );
$$;

create or replace function public.is_screen_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where id = (select auth.uid()) and role in ('administrator', 'operator', 'viewer')
  );
$$;

create or replace function public.create_screen_pairing_code(p_screen_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_bytes bytea;
begin
  if not public.is_screen_operator() then
    raise exception 'Only an administrator or operator can pair screens.';
  end if;

  if not exists (select 1 from public.screens where id = p_screen_id) then
    raise exception 'That screen could not be found.';
  end if;

  v_bytes := extensions.gen_random_bytes(4);
  v_code := lpad(((get_byte(v_bytes, 0)::bigint * 16777216
    + get_byte(v_bytes, 1)::bigint * 65536
    + get_byte(v_bytes, 2)::bigint * 256
    + get_byte(v_bytes, 3)::bigint) % 1000000)::text, 6, '0');

  update public.screens
  set pairing_code_hash = extensions.crypt(v_code, extensions.gen_salt('bf')),
      pairing_expires_at = now() + interval '10 minutes',
      pairing_attempts = 0
  where id = p_screen_id;

  return v_code;
end;
$$;

create or replace function public.pair_screen(p_screen_id uuid, p_pairing_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or auth.role() <> 'authenticated'
    or coalesce(auth.jwt() ->> 'is_anonymous', 'false') <> 'true' then
    return false;
  end if;
  if p_pairing_code !~ '^[0-9]{6}$' then
    return false;
  end if;

  update public.screens
  set auth_user_id = v_user_id,
      pairing_code_hash = null,
      pairing_expires_at = null,
      pairing_attempts = 0,
      last_seen_at = now()
  where id = p_screen_id
    and pairing_code_hash is not null
    and pairing_code_hash = extensions.crypt(p_pairing_code, pairing_code_hash)
    and pairing_expires_at > now()
    and pairing_attempts < 8;

  if found then
    return true;
  end if;

  update public.screens
  set pairing_attempts = pairing_attempts + 1,
      pairing_code_hash = case when pairing_attempts >= 7 then null else pairing_code_hash end,
      pairing_expires_at = case when pairing_attempts >= 7 then null else pairing_expires_at end
  where id = p_screen_id
    and pairing_code_hash is not null
    and pairing_expires_at > now()
    and pairing_attempts < 8;

  return false;
end;
$$;

create or replace function public.screen_heartbeat(p_screen_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seen_at timestamptz;
begin
  update public.screens
  set last_seen_at = clock_timestamp()
  where id = p_screen_id and auth_user_id = auth.uid()
  returning last_seen_at into v_seen_at;
  if v_seen_at is null then
    raise exception 'This screen is no longer paired. Pair it again from the dashboard.';
  end if;
  return v_seen_at;
end;
$$;

create or replace function public.screen_server_time()
returns timestamptz
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  select clock_timestamp();
$$;

create or replace function public.publish_screen_content(p_screen_ids uuid[], p_content jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_screen_id uuid;
  v_started_at timestamptz := clock_timestamp();
  v_content jsonb;
  v_labels text[];
  v_type text;
begin
  if not public.is_screen_operator() then
    raise exception 'Your account can view screens but cannot change them.';
  end if;
  if p_screen_ids is null or cardinality(p_screen_ids) = 0 or cardinality(p_screen_ids) > 4 then
    raise exception 'Choose between one and four screens.';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'The content could not be prepared. Please try again.';
  end if;
  v_type := p_content ->> 'type';
  if v_type is null or v_type not in ('standby', 'image', 'video', 'playlist', 'timer', 'announcement', 'programme') then
    raise exception 'That content type is not supported.';
  end if;
  if v_type in ('image', 'video', 'playlist') then
    if jsonb_typeof(p_content -> 'media_ids') <> 'array' then
      raise exception 'Choose at least one valid media item.';
    end if;
    if jsonb_array_length(p_content -> 'media_ids') = 0 or jsonb_array_length(p_content -> 'media_ids') > 50 then
      raise exception 'Choose between one and 50 media items.';
    end if;
    if coalesce((p_content ->> 'image_duration_seconds')::integer, 0) not between 3 and 600 then
      raise exception 'Image duration must be between 3 and 600 seconds.';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(p_content -> 'media_ids') media_id
      where not exists (select 1 from public.media_assets where id = media_id::uuid)
    ) then
      raise exception 'Some selected media is no longer available. Refresh your library.';
    end if;
  end if;
  if v_type = 'timer' and coalesce((p_content ->> 'duration_seconds')::integer, 0) not between 60 and 14400 then
    raise exception 'Countdowns must be between one minute and four hours.';
  end if;
  if (select count(*) <> count(distinct requested.screen_id)
      from unnest(p_screen_ids) as requested(screen_id))
    or (select count(*) from public.screens where id = any(p_screen_ids)) <> cardinality(p_screen_ids) then
    raise exception 'One of the selected screens could not be found.';
  end if;

  select array_agg(label order by label) into v_labels
  from public.screens where id = any(p_screen_ids);

  v_content := p_content;
  if v_type = 'timer' then
    v_content := jsonb_set(v_content, '{started_at}', to_jsonb(v_started_at), true);
    v_content := v_content - 'paused_at';
  end if;

  foreach v_screen_id in array p_screen_ids loop
    insert into public.screen_assignments (screen_id, content, updated_by, updated_at)
    values (v_screen_id, v_content, auth.uid(), v_started_at)
    on conflict (screen_id) do update
      set content = excluded.content,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
  end loop;

  insert into public.activity_log (user_id, action, metadata)
  values (auth.uid(), case when v_type = 'standby' then 'stop_display' else 'publish_content' end,
    jsonb_build_object('type', v_type, 'screen_labels', to_jsonb(v_labels)));
end;
$$;

create or replace function public.control_screen_timer(p_screen_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_content jsonb;
  v_now timestamptz := clock_timestamp();
  v_started_at timestamptz;
  v_remaining integer;
begin
  if not public.is_screen_operator() then
    raise exception 'Your account can view screens but cannot control the timer.';
  end if;
  if p_action is null or p_action not in ('pause', 'resume') then
    raise exception 'Choose pause or resume.';
  end if;
  select content into v_content from public.screen_assignments
  where screen_id = p_screen_id for update;
  if v_content is null or coalesce(v_content ->> 'type', '') <> 'timer' then
    raise exception 'There is no countdown on this screen.';
  end if;

  if p_action = 'pause' then
    if v_content ? 'paused_at' then
      raise exception 'This countdown is already paused.';
    end if;
    v_started_at := (v_content ->> 'started_at')::timestamptz;
    v_remaining := greatest(0, floor(extract(epoch from (v_started_at
      + ((v_content ->> 'duration_seconds')::integer * interval '1 second') - v_now))::integer));
    v_content := jsonb_set(v_content, '{duration_seconds}', to_jsonb(v_remaining), true);
    v_content := jsonb_set(v_content, '{paused_at}', to_jsonb(v_now), true);
  else
    if v_content ? 'paused_at' then
      v_content := jsonb_set(v_content, '{started_at}', to_jsonb(v_now), true);
      v_content := v_content - 'paused_at';
    else
      raise exception 'This countdown is already running.';
    end if;
  end if;

  update public.screen_assignments
  set content = v_content, updated_by = auth.uid(), updated_at = v_now
  where screen_id = p_screen_id;
  insert into public.activity_log (user_id, action, metadata)
  select auth.uid(), 'timer_' || p_action, jsonb_build_object('screen_labels', jsonb_build_array(s.label))
  from public.screens s where s.id = p_screen_id;
end;
$$;

create or replace function public.control_screen_playback(p_screen_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_content jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_screen_operator() then
    raise exception 'Your account can view screens but cannot control playback.';
  end if;
  if p_action is null or p_action not in ('pause', 'resume') then
    raise exception 'Choose pause or resume.';
  end if;
  select content into v_content from public.screen_assignments
  where screen_id = p_screen_id for update;
  if v_content is null or coalesce(v_content ->> 'type', '') not in ('image', 'video', 'playlist') then
    raise exception 'There is no picture or video playing on this screen.';
  end if;

  if p_action = 'pause' then
    if v_content ? 'paused_at' then
      raise exception 'Playback is already paused.';
    end if;
    v_content := jsonb_set(v_content, '{paused_at}', to_jsonb(v_now), true);
  else
    if not (v_content ? 'paused_at') then
      raise exception 'Playback is already running.';
    end if;
    v_content := v_content - 'paused_at';
  end if;

  update public.screen_assignments
  set content = v_content, updated_by = auth.uid(), updated_at = v_now
  where screen_id = p_screen_id;
  insert into public.activity_log (user_id, action, metadata)
  select auth.uid(), 'playback_' || p_action, jsonb_build_object('screen_labels', jsonb_build_array(s.label))
  from public.screens s where s.id = p_screen_id;
end;
$$;

alter table public.user_profiles enable row level security;
alter table public.screens enable row level security;
alter table public.media_assets enable row level security;
alter table public.screen_assignments enable row level security;
alter table public.programme_items enable row level security;
alter table public.activity_log enable row level security;

drop policy if exists "Profiles can be read by their owner or administrators" on public.user_profiles;
create policy "Profiles can be read by their owner or administrators" on public.user_profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_screen_admin());
drop policy if exists "Administrators can update profiles" on public.user_profiles;
create policy "Administrators can update profiles" on public.user_profiles
  for update to authenticated using (public.is_screen_admin()) with check (public.is_screen_admin());

drop policy if exists "Operators and paired screens can read screens" on public.screens;
create policy "Operators and paired screens can read screens" on public.screens
  for select to authenticated using (public.is_screen_member() or auth_user_id = (select auth.uid()));
drop policy if exists "Operators can manage screens" on public.screens;
drop policy if exists "Operators can update screens" on public.screens;

drop policy if exists "Operators and assigned screens can read media metadata" on public.media_assets;
create policy "Operators and assigned screens can read media metadata" on public.media_assets
  for select to authenticated using (
    public.is_screen_operator()
    or exists (
      select 1 from public.screen_assignments a
      join public.screens s on s.id = a.screen_id
      where s.auth_user_id = (select auth.uid())
        and a.content -> 'media_ids' ? public.media_assets.id::text
    )
  );
drop policy if exists "Operators can add their media metadata" on public.media_assets;
create policy "Operators can add their media metadata" on public.media_assets
  for insert to authenticated with check (public.is_screen_operator() and uploaded_by = (select auth.uid()));
drop policy if exists "Operators can delete their media metadata" on public.media_assets;
create policy "Operators can delete their media metadata" on public.media_assets
  for delete to authenticated using (public.is_screen_operator() and (uploaded_by = (select auth.uid()) or exists (
    select 1 from public.user_profiles where id = (select auth.uid()) and role = 'administrator'
  )));

drop policy if exists "Operators and paired screens can read assignments" on public.screen_assignments;
create policy "Operators and paired screens can read assignments" on public.screen_assignments
  for select to authenticated using (public.is_screen_member() or exists (
    select 1 from public.screens s where s.id = screen_id and s.auth_user_id = (select auth.uid())
  ));

drop policy if exists "Operators can read programme" on public.programme_items;
create policy "Operators can read programme" on public.programme_items
  for select to authenticated using (
    public.is_screen_member()
    or exists (
      select 1 from public.screen_assignments a
      join public.screens s on s.id = a.screen_id
      where s.auth_user_id = (select auth.uid()) and a.content ->> 'type' = 'programme'
    )
  );
drop policy if exists "Operators can add programme items" on public.programme_items;
create policy "Operators can add programme items" on public.programme_items
  for insert to authenticated with check (public.is_screen_operator() and created_by = (select auth.uid()));
drop policy if exists "Operators can update programme items" on public.programme_items;
create policy "Operators can update programme items" on public.programme_items
  for update to authenticated using (public.is_screen_operator()) with check (public.is_screen_operator());
drop policy if exists "Operators can delete programme items" on public.programme_items;
create policy "Operators can delete programme items" on public.programme_items
  for delete to authenticated using (public.is_screen_operator());

drop policy if exists "Operators can read activity" on public.activity_log;
create policy "Operators can read activity" on public.activity_log
  for select to authenticated using (public.is_screen_member());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screen-media', 'screen-media', false, 104857600, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'])
on conflict (id) do update set
  public = false,
  file_size_limit = 104857600,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];

drop policy if exists "Operators can upload media to their own folder" on storage.objects;
create policy "Operators can upload media to their own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'screen-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_screen_operator()
  );
drop policy if exists "Operators and assigned screens can read media files" on storage.objects;
create policy "Operators and assigned screens can read media files" on storage.objects
  for select to authenticated using (
    bucket_id = 'screen-media'
    and (
      public.is_screen_operator()
      or exists (
        select 1 from public.media_assets m
        join public.screen_assignments a on a.content -> 'media_ids' ? m.id::text
        join public.screens s on s.id = a.screen_id
        where m.storage_path = storage.objects.name and s.auth_user_id = (select auth.uid())
      )
    )
  );
drop policy if exists "Operators can remove their own unused files" on storage.objects;
create policy "Operators can remove their own unused files" on storage.objects
  for delete to authenticated using (
    bucket_id = 'screen-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_screen_operator()
    and not exists (select 1 from public.media_assets where storage_path = storage.objects.name)
  );

grant select on public.user_profiles, public.screens, public.media_assets, public.screen_assignments,
  public.programme_items, public.activity_log to authenticated;
grant update on public.user_profiles to authenticated;
grant insert, update, delete on public.programme_items to authenticated;
grant insert, delete on public.media_assets to authenticated;

revoke all on function public.create_screen_pairing_code(uuid) from public, anon;
revoke all on function public.pair_screen(uuid, text) from public, anon;
revoke all on function public.screen_heartbeat(uuid) from public, anon;
revoke all on function public.screen_server_time() from public, anon;
revoke all on function public.publish_screen_content(uuid[], jsonb) from public, anon;
revoke all on function public.control_screen_timer(uuid, text) from public, anon;
revoke all on function public.control_screen_playback(uuid, text) from public, anon;
revoke all on function public.is_screen_operator() from public, anon;
revoke all on function public.is_screen_admin() from public, anon;
revoke all on function public.is_screen_member() from public, anon;
grant execute on function public.create_screen_pairing_code(uuid) to authenticated;
grant execute on function public.pair_screen(uuid, text) to authenticated;
grant execute on function public.screen_heartbeat(uuid) to authenticated;
grant execute on function public.screen_server_time() to authenticated;
grant execute on function public.publish_screen_content(uuid[], jsonb) to authenticated;
grant execute on function public.control_screen_timer(uuid, text) to authenticated;
grant execute on function public.control_screen_playback(uuid, text) to authenticated;
grant execute on function public.is_screen_operator() to authenticated;
grant execute on function public.is_screen_admin() to authenticated;
grant execute on function public.is_screen_member() to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'screens') then
    alter publication supabase_realtime add table public.screens;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'screen_assignments') then
    alter publication supabase_realtime add table public.screen_assignments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'media_assets') then
    alter publication supabase_realtime add table public.media_assets;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'programme_items') then
    alter publication supabase_realtime add table public.programme_items;
  end if;
end;
$$;
