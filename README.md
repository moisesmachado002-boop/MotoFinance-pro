# MotoFinance PRO — Versão 1

Aplicativo PWA para controlar ganhos, gastos, veículos, odômetro e lembretes de manutenção. A interface é responsiva e funciona em celular e notebook.

## Recursos

- Painel mensal com ganhos, gastos e resultado real, inclusive negativo.
- Categorias para corridas, entregas, fretes, combustível, manutenção, impostos e outros.
- Cadastro e seleção de vários veículos.
- Odômetro atualizado pelo veículo ou durante um lançamento.
- Alarmes por quilometragem, tempo ou ambos.
- Gráficos por categoria, mês e veículo.
- Pesquisa e filtros no histórico financeiro.
- Backup JSON, restauração e exportação CSV.
- Funcionamento offline após o primeiro acesso.
- Importação automática dos lançamentos salvos na versão anterior.

## Dados

Os dados ficam no navegador de cada aparelho. Para levar os dados do celular ao notebook, faça um backup no primeiro aparelho e use **Restaurar backup** no segundo.

## Testes

Execute:

```bash
node tests/test_core.js
```

O conjunto cobre validação, cálculos financeiros, filtros, categorias e estados dos alarmes.
