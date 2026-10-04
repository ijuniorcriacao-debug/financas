# Banco de dados online (Supabase) — roteiro

Objetivo: login para cada pessoa, os dois lançando de celulares diferentes e a privacidade
dos gastos "só meu" garantida **no servidor**.

## Já pronto
- `schema.sql`: tabelas (`households`, `members`, `cats`, `tpl`, `tx`), funções
  `create_household` / `join_household` (convite por código de 8 caracteres) e regras de
  segurança (RLS). Testado num Postgres local com 23 verificações, todas passando: o parceiro
  não vê gasto `vis = private`, ninguém altera gasto pessoal alheio, quem é de fora não acessa nada.

## Feito também (código)
- Login, criação da casa, convite por código e sincronização estão em `app.js` (seção "nuvem"), ligados por `config.js`.
  Com `config.js` vazio o app segue no modo local, sem login. Testado com um banco simulado e dois usuários: 17 verificações passando.

## Situação
- Banco aplicado no projeto `apsnhujsytxtiidouxpt` (tabelas, funções, 13 regras RLS, Realtime) e `config.js` preenchido.
  Regras de privacidade verificadas no banco real (8 testes, em transação desfeita).
- Se for recriar o banco: `schema.sql` é idempotente; no conector, aplicar em partes (a execução única estourou o tempo).

## Falta fazer (item 4: configurações do painel, só o dono faz)
1. Rodar `schema.sql` no projeto Supabase das finanças (SQL Editor → Run, ou via conector).
   Projeto novo: `apsnhujsytxtiidouxpt`. **Nunca usar** o projeto `xnzbeujtwagzkmogkifz`
   (é o app de personal, com dados de alunos).
2. Pegar a Project URL e a publishable key (`sb_publishable_...`) e colocar em `config.js`
   (`window.SUPABASE_CONFIG = { url, key }`). A chave pública pode ficar no repositório.
3. Client em `app.js` (com a lib `@supabase/supabase-js@2` em `index.html`, versão fixa):
   - telas de login/criar conta e de "criar casa" / "entrar com código";
   - `pull()` lê tudo (paginado de 1000 em 1000) e monta o estado `S`;
   - `save()` calcula a diferença contra o último estado do servidor e envia `upsert`/`delete`
     (linhas novas com `ignoreDuplicates`; contas fixas com id `${tpl.id}-${AAAA-MM}` para
     os dois celulares não duplicarem);
   - Realtime para atualizar quando o parceiro lança algo; recarrega ao voltar ao app;
   - cada um edita só a própria renda e o próprio nome; só duas abas: **Casa** e a própria;
   - gasto pessoal sempre com `payer` = quem está logado.
4. No painel Supabase (Authentication): em *URL Configuration* colocar o Site URL
   `https://ijuniorcriacao-debug.github.io/financas/`; em *Sign In / Providers → Email*, desligar
   "Confirm email" se quiserem entrar sem confirmar por e-mail.
5. Testar com duas contas e publicar.
