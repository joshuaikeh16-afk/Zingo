alter table public.profiles
  drop constraint if exists profiles_profile_template_check;

alter table public.profiles
  add constraint profiles_profile_template_check
  check (profile_template in ('midnight', 'sakura', 'ocean', 'sunset', 'monochrome', 'cyberpunk', 'forest', 'starlight'));
