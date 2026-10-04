-- Finanças da Casa — esquema do banco (Supabase / Postgres)
-- Cole este arquivo inteiro em: Supabase → SQL Editor → New query → Run.
-- Pode ser executado mais de uma vez sem quebrar nada.

-- ---------------------------------------------------------------- tabelas
create table if not exists public.households (
  id           uuid primary key default gen_random_uuid(),
  invite_code  text not null unique,
  savings_pct  int  not null default 20 check (savings_pct between 0 and 100),
  created_at   timestamptz not null default now()
);

create table if not exists public.members (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  idx           smallint not null check (idx in (0, 1)),
  name          text not null check (char_length(name) between 1 and 40),
  income_cents  bigint not null default 0 check (income_cents >= 0),
  unique (household_id, idx)
);

create table if not exists public.cats (
  household_id  uuid not null references public.households(id) on delete cascade,
  id            text not null,
  name          text not null,
  emoji         text not null default '📦',
  essential     boolean not null default false,
  budget_cents  bigint not null default 0 check (budget_cents >= 0),
  primary key (household_id, id)
);

create table if not exists public.tpl (
  id            text primary key,
  household_id  uuid not null references public.households(id) on delete cascade,
  descr         text not null,
  cents         bigint not null check (cents > 0),
  day           smallint not null check (day between 1 and 31),
  cat           text not null,
  payer         text not null check (payer in ('0', '1', 'joint')),
  split         text not null check (split in ('shared', 'personal')),
  vis           text check (vis in ('open', 'private')),
  active        boolean not null default true,
  start_ym      text not null,
  check (not (split = 'personal' and payer = 'joint'))
);

create table if not exists public.tx (
  id            text primary key,
  household_id  uuid not null references public.households(id) on delete cascade,
  kind          text not null check (kind in ('despesa', 'receita', 'acerto')),
  date          date not null,
  descr         text not null,
  cents         bigint not null check (cents > 0),
  cat           text,
  nature        text check (nature in ('fixa', 'variavel', 'esporadica')),
  payer         text not null check (payer in ('0', '1', 'joint')),
  split         text check (split in ('shared', 'personal')),
  vis           text check (vis in ('open', 'private')),
  paid          boolean not null default false,
  tpl_id        text,
  grp           text,
  check (not (split = 'personal' and payer = 'joint'))
);
create index if not exists tx_household_date on public.tx (household_id, date);
create index if not exists tpl_household on public.tpl (household_id);

-- ------------------------------------------------------- funções auxiliares
create or replace function public.my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.members where user_id = auth.uid()
$$;

create or replace function public.my_idx() returns text
language sql stable security definer set search_path = public as $$
  select idx::text from public.members where user_id = auth.uid()
$$;

-- Criar a casa (1ª pessoa) e entrar nela com o código (2ª pessoa).
create or replace function public.create_household(p_name text, p_income bigint)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already_member';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.households (invite_code) values (v_code) returning id into v_id;
  insert into public.members (user_id, household_id, idx, name, income_cents)
  values (auth.uid(), v_id, 0, left(coalesce(nullif(trim(p_name), ''), 'Pessoa 1'), 40),
          greatest(coalesce(p_income, 0), 0));
  return v_code;
end $$;

create or replace function public.join_household(p_code text, p_name text, p_income bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already_member';
  end if;
  select id into v_id from public.households where invite_code = upper(trim(p_code));
  if v_id is null then raise exception 'invalid_code'; end if;
  if (select count(*) from public.members where household_id = v_id) >= 2 then
    raise exception 'household_full';
  end if;
  insert into public.members (user_id, household_id, idx, name, income_cents)
  values (auth.uid(), v_id, 1, left(coalesce(nullif(trim(p_name), ''), 'Pessoa 2'), 40),
          greatest(coalesce(p_income, 0), 0));
end $$;

revoke all on function public.my_household(), public.my_idx(),
  public.create_household(text, bigint), public.join_household(text, text, bigint) from public, anon;
grant execute on function public.my_household(), public.my_idx(),
  public.create_household(text, bigint), public.join_household(text, text, bigint) to authenticated;

-- ---------------------------------------------------------------- segurança
alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.cats       enable row level security;
alter table public.tpl        enable row level security;
alter table public.tx         enable row level security;

revoke all on public.households, public.members, public.cats, public.tpl, public.tx from anon;
revoke all on public.households, public.members, public.cats, public.tpl, public.tx from authenticated;
grant select on public.households, public.members to authenticated;
grant update (savings_pct) on public.households to authenticated;
grant update (name, income_cents) on public.members to authenticated;
grant select, insert, update, delete on public.cats, public.tpl, public.tx to authenticated;

drop policy if exists households_select on public.households;
create policy households_select on public.households for select to authenticated
  using (id = public.my_household());
drop policy if exists households_update on public.households;
create policy households_update on public.households for update to authenticated
  using (id = public.my_household()) with check (id = public.my_household());

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (household_id = public.my_household());
drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists cats_all on public.cats;
create policy cats_all on public.cats for all to authenticated
  using (household_id = public.my_household()) with check (household_id = public.my_household());

-- Gasto pessoal = despesa com split 'personal'.
--   ver:      o dono sempre; o parceiro só se NÃO for "só meu" (vis = 'private').
--   alterar:  só o dono. Tudo o que é da casa, os dois veem e alteram.
drop policy if exists tx_select on public.tx;
create policy tx_select on public.tx for select to authenticated using (
  household_id = public.my_household()
  and (kind <> 'despesa' or coalesce(split, '') <> 'personal'
       or payer = public.my_idx() or coalesce(vis, 'open') <> 'private')
);
drop policy if exists tx_insert on public.tx;
create policy tx_insert on public.tx for insert to authenticated with check (
  household_id = public.my_household()
  and (kind <> 'despesa' or coalesce(split, '') <> 'personal' or payer = public.my_idx())
);
drop policy if exists tx_update on public.tx;
create policy tx_update on public.tx for update to authenticated
  using (household_id = public.my_household()
         and (kind <> 'despesa' or coalesce(split, '') <> 'personal' or payer = public.my_idx()))
  with check (household_id = public.my_household()
         and (kind <> 'despesa' or coalesce(split, '') <> 'personal' or payer = public.my_idx()));
drop policy if exists tx_delete on public.tx;
create policy tx_delete on public.tx for delete to authenticated using (
  household_id = public.my_household()
  and (kind <> 'despesa' or coalesce(split, '') <> 'personal' or payer = public.my_idx())
);

-- Contas fixas: mesma regra (as pessoais só o dono vê e altera).
drop policy if exists tpl_select on public.tpl;
create policy tpl_select on public.tpl for select to authenticated using (
  household_id = public.my_household()
  and (split <> 'personal' or payer = public.my_idx() or coalesce(vis, 'open') <> 'private')
);
drop policy if exists tpl_insert on public.tpl;
create policy tpl_insert on public.tpl for insert to authenticated with check (
  household_id = public.my_household() and (split <> 'personal' or payer = public.my_idx())
);
drop policy if exists tpl_update on public.tpl;
create policy tpl_update on public.tpl for update to authenticated
  using (household_id = public.my_household() and (split <> 'personal' or payer = public.my_idx()))
  with check (household_id = public.my_household() and (split <> 'personal' or payer = public.my_idx()));
drop policy if exists tpl_delete on public.tpl;
create policy tpl_delete on public.tpl for delete to authenticated using (
  household_id = public.my_household() and (split <> 'personal' or payer = public.my_idx())
);

-- --------------------------------------------------- atualização em tempo real
do $$
declare t text;
begin
  foreach t in array array['households', 'members', 'cats', 'tpl', 'tx'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
