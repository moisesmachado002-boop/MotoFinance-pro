# MotoFinance PRO — Versão 1

PWA para controlar ganhos, gastos, veículos, odômetro, metas e lembretes de manutenção, com uso offline e sincronização opcional por conta via Supabase.

## Recursos

- Painel mensal com ganhos, gastos e resultado real.
- Cadastro de vários veículos, odômetro e histórico de leituras.
- Lembretes por quilometragem, tempo ou ambos.
- Análises por categoria, mês e veículo.
- Metas semanais e mensais; a meta semanal mostra o progresso da semana atual.
- Backup JSON, restauração e exportação CSV.
- PWA offline após o primeiro carregamento dos recursos.
- Conta por e-mail/senha e sincronização opcional com Supabase.
- Conflitos entre aparelhos nunca substituem silenciosamente duas cópias diferentes.
- Mesclagem usa metadados por item e tombstones de exclusão; empates irresolvíveis exigem escolha explícita.

## Modelo de dados e segurança

O estado principal continua no `localStorage` para funcionamento offline. Ao entrar em uma conta, o aplicativo mantém snapshots locais separados por usuário e usa `public.motofinance_state` no Supabase para a cópia remota.

A tabela remota usa RLS por `auth.uid() = user_id`, controle otimista de `version` e um `sync_meta` separado para timestamps/tombstones de sincronização. O frontend usa somente a chave publishable. Nunca coloque `service_role` ou chaves secretas neste repositório.

**Apagar dados deste aparelho** e **restaurar backup** são operações locais: elas suspendem o envio automático até o usuário decidir sincronizar novamente. A exclusão remota deve ser uma ação separada e explícita.

Antes de substituições automáticas, o aplicativo mantém backups locais rotativos. O `preflight.js` também preserva uma cópia antes da normalização do estado, reduzindo o risco de perder registros reparáveis.

## Service worker

Os módulos de sincronização são carregados explicitamente pelo `index.html`; o service worker não altera nem injeta JavaScript em `script.js`. Na ativação, ele remove somente caches cujo nome começa com `motofinance-pro-`, sem tocar em caches de outros PWAs do mesmo domínio.

## Testes

O CI usa Node 24 e executa verificações de sintaxe mais:

```bash
node tests/test_core.js
node tests/test_static.js
node tests/test_sync.js
```

Os testes de sync cobrem conflito por item, edição concorrente, tombstone de exclusão, isolamento por conta, restauração/apagamento local, carregamento explícito dos módulos, cache isolado, RLS/migrations e limites do snapshot.

## Limites conhecidos

- O snapshot remoto ainda é um único JSON por usuário; é adequado à V1, mas uma versão com grande volume de dados deve migrar movimentações/veículos/lembretes para tabelas relacionais próprias.
- A atualização entre aparelhos acontece ao detectar mudanças locais, retorno da rede e sincronização manual; não há assinatura Supabase Realtime nesta V1.
- Confirmação de cadastro e recuperação de senha dependem de `auth.html` estar permitido nas Redirect URLs do Supabase Auth.
