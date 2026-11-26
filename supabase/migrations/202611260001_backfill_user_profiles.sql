insert into public.user_profiles (id, full_name)
select id, nullif(raw_user_meta_data ->> 'full_name', '')
from auth.users
where is_anonymous = false
on conflict (id) do nothing;
